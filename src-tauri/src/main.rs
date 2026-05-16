#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod keyboard_hook;
mod paste;
mod realtime_asr;
mod shortcuts;
mod tray;

use tauri::{Manager, WindowEvent};

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_http::init())
        .manage(realtime_asr::RealtimeAsrState::default())
        .invoke_handler(tauri::generate_handler![
            commands::simulate_paste,
            commands::show_settings,
            commands::show_floating,
            commands::default_shortcut,
            commands::configure_hold_key,
            commands::open_microphone_settings,
            commands::quit_app,
            commands::load_local_settings,
            commands::save_local_settings,
            commands::load_local_history,
            commands::save_local_history,
            commands::clear_local_history,
            commands::get_clipboard_log_path,
            commands::append_clipboard_log,
            commands::get_local_data_paths,
            commands::clear_all_local_data,
            realtime_asr::realtime_asr_start,
            realtime_asr::realtime_asr_append_audio,
            realtime_asr::realtime_asr_finish,
            realtime_asr::realtime_asr_cancel
        ])
        .setup(|app| {
            keyboard_hook::start(app.handle().clone());
            tray::create_tray(app)?;
            if let Some(window) = app.get_webview_window("floating") {
                let _ = window.set_always_on_top(true);
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Tauri application");
}
