use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
};

use tauri::{AppHandle, Emitter, Manager};

const SETTINGS_FILE: &str = "settings.json";
const HISTORY_FILE: &str = "history.json";
const LOG_FILE: &str = "clipboard-history.jsonl";

fn app_data_path(app: &AppHandle, file_name: &str) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|error| error.to_string())?;

    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir.join(file_name))
}

fn read_app_data_file(app: &AppHandle, file_name: &str) -> Result<Option<String>, String> {
    let path = app_data_path(app, file_name)?;

    match fs::read_to_string(&path) {
        Ok(content) => Ok(Some(content)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

fn write_app_data_file(app: &AppHandle, file_name: &str, content: &str) -> Result<(), String> {
    serde_json::from_str::<serde_json::Value>(content).map_err(|error| error.to_string())?;

    let path = app_data_path(app, file_name)?;
    fs::write(path, content).map_err(|error| error.to_string())
}

fn remove_app_data_file(app: &AppHandle, file_name: &str) -> Result<(), String> {
    let path = app_data_path(app, file_name)?;

    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

fn install_dir_log_path() -> Result<PathBuf, String> {
    let exe_path = std::env::current_exe().map_err(|error| error.to_string())?;
    let exe_dir = exe_path
        .parent()
        .ok_or_else(|| "Cannot resolve application directory".to_string())?;

    Ok(exe_dir.join("logs").join(LOG_FILE))
}

fn ensure_writable_log_path(path: &Path) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map(|_| ())
        .map_err(|error| error.to_string())
}

fn fallback_log_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|error| error.to_string())?
        .join("logs");

    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir.join(LOG_FILE))
}

fn clipboard_log_path(app: &AppHandle, create: bool) -> Result<PathBuf, String> {
    if let Ok(path) = install_dir_log_path() {
        if !create {
            return Ok(path);
        }

        if ensure_writable_log_path(&path).is_ok() {
            return Ok(path);
        }
    }

    let fallback = fallback_log_path(app)?;
    if create {
        ensure_writable_log_path(&fallback)?;
    }
    Ok(fallback)
}

pub fn reveal_settings_window(app: &tauri::AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "Settings window is not available".to_string())?;

    window.show().map_err(|error| error.to_string())?;
    let _ = window.unminimize();

    // On Windows, focusing a background window can be denied by the OS. Showing
    // the window must still succeed, and the temporary topmost flip reliably
    // brings the settings window forward without leaving it pinned.
    let _ = window.set_always_on_top(true);
    let _ = window.set_focus();
    let _ = window.set_always_on_top(false);
    let _ = app.emit("show-settings", ());

    Ok(())
}

#[tauri::command]
pub fn simulate_paste() -> Result<(), String> {
    crate::paste::simulate_ctrl_v()
}

#[tauri::command]
pub fn show_settings(app: tauri::AppHandle) -> Result<(), String> {
    reveal_settings_window(&app)
}

#[tauri::command]
pub fn show_floating(app: tauri::AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("floating")
        .ok_or_else(|| "Floating window is not available".to_string())?;

    window.show().map_err(|error| error.to_string())?;
    let _ = window.unminimize();
    let _ = window.set_always_on_top(true);
    let _ = window.set_focus();

    Ok(())
}

#[tauri::command]
pub fn default_shortcut() -> &'static str {
    crate::shortcuts::DEFAULT_SHORTCUT
}

#[tauri::command]
pub fn configure_hold_key(enabled: bool, key: String) -> Result<(), String> {
    crate::keyboard_hook::configure(enabled, &key)
}

#[tauri::command]
pub fn open_microphone_settings() -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", "ms-settings:privacy-microphone"])
            .spawn()
            .map_err(|error| error.to_string())?;
        return Ok(());
    }

    #[cfg(not(target_os = "windows"))]
    {
        Err("Opening microphone privacy settings is only implemented on Windows.".to_string())
    }
}

#[tauri::command]
pub fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

#[tauri::command]
pub fn load_local_settings(app: AppHandle) -> Result<Option<String>, String> {
    read_app_data_file(&app, SETTINGS_FILE)
}

#[tauri::command]
pub fn save_local_settings(app: AppHandle, settings_json: String) -> Result<(), String> {
    write_app_data_file(&app, SETTINGS_FILE, &settings_json)
}

#[tauri::command]
pub fn load_local_history(app: AppHandle) -> Result<Option<String>, String> {
    read_app_data_file(&app, HISTORY_FILE)
}

#[tauri::command]
pub fn save_local_history(app: AppHandle, history_json: String) -> Result<(), String> {
    write_app_data_file(&app, HISTORY_FILE, &history_json)
}

#[tauri::command]
pub fn clear_local_history(app: AppHandle) -> Result<(), String> {
    remove_app_data_file(&app, HISTORY_FILE)
}

#[tauri::command]
pub fn get_clipboard_log_path(app: AppHandle) -> Result<String, String> {
    clipboard_log_path(&app, false).map(|path| path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn append_clipboard_log(app: AppHandle, entry_json: String) -> Result<(), String> {
    let entry: serde_json::Value =
        serde_json::from_str(&entry_json).map_err(|error| error.to_string())?;
    let line = serde_json::to_string(&entry).map_err(|error| error.to_string())?;
    let path = clipboard_log_path(&app, true)?;
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|error| error.to_string())?;

    writeln!(file, "{line}").map_err(|error| error.to_string())
}

#[tauri::command]
pub fn get_local_data_paths(app: AppHandle) -> Result<serde_json::Value, String> {
    let settings_path = app_data_path(&app, SETTINGS_FILE)?;
    let history_path = app_data_path(&app, HISTORY_FILE)?;
    let log_path = clipboard_log_path(&app, false)?;

    Ok(serde_json::json!({
        "settingsPath": settings_path.to_string_lossy(),
        "historyPath": history_path.to_string_lossy(),
        "logPath": log_path.to_string_lossy(),
    }))
}

#[tauri::command]
pub fn clear_all_local_data(app: AppHandle) -> Result<(), String> {
    remove_app_data_file(&app, SETTINGS_FILE)?;
    remove_app_data_file(&app, HISTORY_FILE)?;

    if let Ok(path) = clipboard_log_path(&app, false) {
        match fs::remove_file(path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.to_string()),
        }
    }

    let fallback_log_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|error| error.to_string())?
        .join("logs");

    match fs::remove_dir_all(fallback_log_dir) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error.to_string()),
    }

    Ok(())
}
