use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::{mpsc, oneshot, Mutex};
use tokio::time::{timeout, Duration};
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::header::{HeaderValue, AUTHORIZATION};
use tokio_tungstenite::tungstenite::Message;

const REALTIME_ENDPOINT: &str = "wss://dashscope.aliyuncs.com/api-ws/v1/realtime";
const REALTIME_MODEL: &str = "qwen3-asr-flash-realtime";
const FINAL_TIMEOUT_SECONDS: u64 = 18;

#[derive(Default)]
pub struct RealtimeAsrState {
    session: Mutex<Option<RealtimeSession>>,
}

struct RealtimeSession {
    tx: mpsc::UnboundedSender<Message>,
    final_rx: oneshot::Receiver<Result<String, String>>,
    latest_text: Arc<Mutex<String>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RealtimeAsrConfig {
    api_key: String,
    model: String,
    language: Option<String>,
    vad_silence_duration_ms: Option<u16>,
    vad_threshold: Option<f32>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct RealtimeAsrEvent {
    kind: String,
    text: Option<String>,
    message: Option<String>,
}

fn event_id(prefix: &str) -> String {
    use std::time::{SystemTime, UNIX_EPOCH};

    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default();

    format!("{prefix}_{millis}")
}

fn realtime_model(model: &str) -> &str {
    let model = model.trim();
    if model.is_empty() {
        REALTIME_MODEL
    } else {
        model
    }
}

fn preview_text_from_event(value: &Value) -> Option<String> {
    let text = value
        .get("text")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let stash = value
        .get("stash")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let preview = format!("{text}{stash}").trim().to_string();

    if preview.is_empty() {
        None
    } else {
        Some(preview)
    }
}

fn final_text_from_event(value: &Value) -> Option<String> {
    value
        .get("transcript")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(ToOwned::to_owned)
        .or_else(|| preview_text_from_event(value))
}

fn merge_transcript(committed_text: &str, preview_text: &str) -> String {
    let committed_text = committed_text.trim();
    let preview_text = preview_text.trim();

    match (committed_text.is_empty(), preview_text.is_empty()) {
        (true, true) => String::new(),
        (true, false) => preview_text.to_string(),
        (false, true) => committed_text.to_string(),
        (false, false) => format!("{committed_text}\n{preview_text}"),
    }
}

fn emit_event(app: &AppHandle, kind: &str, text: Option<String>, message: Option<String>) {
    let _ = app.emit(
        "realtime-asr",
        RealtimeAsrEvent {
            kind: kind.to_string(),
            text,
            message,
        },
    );
}

fn session_update(language: &str, vad_threshold: f32, vad_silence_duration_ms: u16) -> String {
    json!({
        "event_id": event_id("session_update"),
        "type": "session.update",
        "session": {
            "modalities": ["text"],
            "input_audio_format": "pcm",
            "sample_rate": 16000,
            "input_audio_transcription": {
                "language": language
            },
            "turn_detection": {
                "type": "server_vad",
                "threshold": vad_threshold,
                "silence_duration_ms": vad_silence_duration_ms
            }
        }
    })
    .to_string()
}

fn audio_append(audio: &str) -> String {
    json!({
        "event_id": event_id("audio"),
        "type": "input_audio_buffer.append",
        "audio": audio
    })
    .to_string()
}

fn finish_event() -> String {
    json!({
        "event_id": event_id("finish"),
        "type": "session.finish"
    })
    .to_string()
}

#[tauri::command]
pub async fn realtime_asr_start(
    app: AppHandle,
    state: State<'_, RealtimeAsrState>,
    config: RealtimeAsrConfig,
) -> Result<(), String> {
    let api_key = config.api_key.trim();
    if api_key.is_empty() {
        return Err("DashScope API Key is missing.".to_string());
    }

    if let Some(session) = state.session.lock().await.take() {
        let _ = session.tx.send(Message::Close(None));
    }

    let url = format!(
        "{REALTIME_ENDPOINT}?model={}",
        realtime_model(&config.model)
    );
    let mut request = url
        .into_client_request()
        .map_err(|error| error.to_string())?;
    request.headers_mut().insert(
        AUTHORIZATION,
        HeaderValue::from_str(&format!("Bearer {api_key}")).map_err(|error| error.to_string())?,
    );
    request
        .headers_mut()
        .insert("OpenAI-Beta", HeaderValue::from_static("realtime=v1"));

    let (socket, _) = connect_async(request)
        .await
        .map_err(|error| error.to_string())?;
    let (mut write, mut read) = socket.split();
    let (tx, mut rx) = mpsc::unbounded_channel::<Message>();
    let (final_tx, final_rx) = oneshot::channel::<Result<String, String>>();
    let latest_text = Arc::new(Mutex::new(String::new()));
    let reader_latest_text = Arc::clone(&latest_text);
    let reader_app = app.clone();

    tauri::async_runtime::spawn(async move {
        while let Some(message) = rx.recv().await {
            if write.send(message).await.is_err() {
                break;
            }
        }
        let _ = write.close().await;
    });

    tauri::async_runtime::spawn(async move {
        let mut final_tx = Some(final_tx);
        let mut committed_text = String::new();

        while let Some(message) = read.next().await {
            let message = match message {
                Ok(message) => message,
                Err(error) => {
                    let message = error.to_string();
                    emit_event(&reader_app, "error", None, Some(message.clone()));
                    if let Some(final_tx) = final_tx.take() {
                        let _ = final_tx.send(Err(message));
                    }
                    return;
                }
            };

            let Ok(text) = message.into_text() else {
                continue;
            };

            let Ok(value) = serde_json::from_str::<Value>(&text) else {
                continue;
            };

            let event_type = value
                .get("type")
                .and_then(Value::as_str)
                .unwrap_or_default();

            match event_type {
                "session.created" => emit_event(&reader_app, "ready", None, None),
                "session.updated" => emit_event(&reader_app, "ready", None, None),
                "input_audio_buffer.speech_started" => {
                    emit_event(&reader_app, "speech_started", None, None)
                }
                "input_audio_buffer.speech_stopped" => {
                    emit_event(&reader_app, "speech_stopped", None, None)
                }
                "conversation.item.input_audio_transcription.text" => {
                    if let Some(preview_text) = preview_text_from_event(&value) {
                        let text = merge_transcript(&committed_text, &preview_text);
                        *reader_latest_text.lock().await = text.clone();
                        emit_event(&reader_app, "partial", Some(text), None);
                    }
                }
                "conversation.item.input_audio_transcription.completed" => {
                    if let Some(segment_text) = final_text_from_event(&value) {
                        committed_text = merge_transcript(&committed_text, &segment_text);
                        *reader_latest_text.lock().await = committed_text.clone();
                        emit_event(&reader_app, "final", Some(committed_text.clone()), None);
                    }
                }
                "session.finished" => {
                    let latest_text = reader_latest_text.lock().await.clone();
                    let text = if latest_text.trim().is_empty() {
                        final_text_from_event(&value).unwrap_or_default()
                    } else {
                        latest_text
                    };

                    if let Some(final_tx) = final_tx.take() {
                        let _ = final_tx.send(if text.trim().is_empty() {
                            Err("Transcription is empty.".to_string())
                        } else {
                            Ok(text)
                        });
                    }
                    return;
                }
                "error" => {
                    let message = value
                        .get("error")
                        .and_then(|error| error.get("message"))
                        .and_then(Value::as_str)
                        .or_else(|| value.get("message").and_then(Value::as_str))
                        .unwrap_or("Realtime ASR request failed.")
                        .to_string();
                    emit_event(&reader_app, "error", None, Some(message.clone()));
                    if let Some(final_tx) = final_tx.take() {
                        let _ = final_tx.send(Err(message));
                    }
                    return;
                }
                _ => {}
            }
        }

        if let Some(final_tx) = final_tx.take() {
            let text = reader_latest_text.lock().await.clone();
            let _ = final_tx.send(if text.trim().is_empty() {
                Err("Realtime ASR connection closed before returning text.".to_string())
            } else {
                Ok(text)
            });
        }
    });

    tx.send(Message::Text(
        session_update(
            config.language.as_deref().unwrap_or("zh"),
            config.vad_threshold.unwrap_or(0.3).clamp(0.0, 1.0),
            config
                .vad_silence_duration_ms
                .unwrap_or(600)
                .clamp(200, 2000),
        )
        .into(),
    ))
    .map_err(|error| error.to_string())?;

    *state.session.lock().await = Some(RealtimeSession {
        tx,
        final_rx,
        latest_text,
    });

    Ok(())
}

#[tauri::command]
pub async fn realtime_asr_append_audio(
    state: State<'_, RealtimeAsrState>,
    audio: String,
) -> Result<(), String> {
    let session = state.session.lock().await;
    let session = session
        .as_ref()
        .ok_or_else(|| "Realtime ASR session is not running.".to_string())?;

    session
        .tx
        .send(Message::Text(audio_append(&audio).into()))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn realtime_asr_finish(state: State<'_, RealtimeAsrState>) -> Result<String, String> {
    let Some(session) = state.session.lock().await.take() else {
        return Err("Realtime ASR session is not running.".to_string());
    };

    let _ = session.tx.send(Message::Text(finish_event().into()));

    match timeout(Duration::from_secs(FINAL_TIMEOUT_SECONDS), session.final_rx).await {
        Ok(Ok(result)) => result,
        Ok(Err(_)) => {
            let text = session.latest_text.lock().await.clone();
            if text.trim().is_empty() {
                Err("Realtime ASR stopped before returning final text.".to_string())
            } else {
                Ok(text)
            }
        }
        Err(_) => {
            let text = session.latest_text.lock().await.clone();
            if text.trim().is_empty() {
                Err("Realtime ASR final result timed out.".to_string())
            } else {
                Ok(text)
            }
        }
    }
}

#[tauri::command]
pub async fn realtime_asr_cancel(state: State<'_, RealtimeAsrState>) -> Result<(), String> {
    if let Some(session) = state.session.lock().await.take() {
        let _ = session.tx.send(Message::Close(None));
    }

    Ok(())
}
