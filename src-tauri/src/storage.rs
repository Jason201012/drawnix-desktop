use std::fs;
use std::path::{Path, PathBuf};

use base64::Engine;
use serde::Deserialize;
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::{DialogExt, FileDialogBuilder};

#[derive(Deserialize)]
pub struct DialogFilter {
    name: String,
    extensions: Vec<String>,
}

fn apply_filters(
    mut builder: FileDialogBuilder<tauri::Wry>,
    filters: &[DialogFilter],
) -> FileDialogBuilder<tauri::Wry> {
    for filter in filters {
        let extensions: Vec<&str> = filter.extensions.iter().map(String::as_str).collect();
        builder = builder.add_filter(&filter.name, &extensions);
    }
    builder
}

fn to_strings(paths: Vec<tauri_plugin_dialog::FilePath>) -> Vec<String> {
    paths
        .into_iter()
        .filter_map(|path| path.into_path().ok())
        .map(|path| path.to_string_lossy().into_owned())
        .collect()
}

#[tauri::command(async)]
pub fn pick_open(
    app: AppHandle,
    filters: Vec<DialogFilter>,
    multiple: bool,
) -> Result<Vec<String>, String> {
    let builder = apply_filters(app.dialog().file().set_title("打开文件"), &filters);
    let picked = if multiple {
        builder.blocking_pick_files()
    } else {
        builder.blocking_pick_file().map(|file| vec![file])
    };
    Ok(to_strings(picked.unwrap_or_default()))
}

#[tauri::command(async)]
pub fn pick_save(
    app: AppHandle,
    default_name: String,
    filters: Vec<DialogFilter>,
) -> Result<Option<String>, String> {
    let builder = apply_filters(
        app.dialog().file().set_file_name(default_name).set_title("保存文件"),
        &filters,
    );
    Ok(builder
        .blocking_save_file()
        .and_then(|path| path.into_path().ok())
        .map(|path| path.to_string_lossy().into_owned()))
}

fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let mut temporary = path.as_os_str().to_owned();
    temporary.push(".tmp");
    let temporary = PathBuf::from(temporary);
    fs::write(&temporary, bytes).map_err(|error| error.to_string())?;
    fs::rename(&temporary, path).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn read_file_base64(path: String) -> Result<String, String> {
    let bytes = fs::read(&path).map_err(|error| error.to_string())?;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

#[tauri::command]
pub fn write_file_base64(path: String, data: String) -> Result<(), String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data)
        .map_err(|error| error.to_string())?;
    atomic_write(Path::new(&path), &bytes)
}

#[tauri::command]
pub fn read_file_text(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn write_file_text(path: String, contents: String) -> Result<(), String> {
    atomic_write(Path::new(&path), contents.as_bytes())
}

#[tauri::command]
pub fn file_exists(path: String) -> bool {
    Path::new(&path).is_file()
}

fn state_path(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app.path().app_config_dir().map_err(|error| error.to_string())?;
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    Ok(directory.join("state.json"))
}

#[tauri::command]
pub fn read_app_state(app: AppHandle) -> Result<serde_json::Value, String> {
    let path = state_path(&app)?;
    if !path.is_file() {
        return Ok(serde_json::json!({}));
    }
    let contents = fs::read_to_string(&path).map_err(|error| error.to_string())?;
    serde_json::from_str(&contents).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn write_app_state(app: AppHandle, state: serde_json::Value) -> Result<(), String> {
    let path = state_path(&app)?;
    let contents = serde_json::to_string_pretty(&state).map_err(|error| error.to_string())?;
    atomic_write(&path, contents.as_bytes())
}

#[tauri::command]
pub fn launch_file_path() -> Option<String> {
    let path = std::env::args().nth(1)?;
    if path.to_lowercase().ends_with(".drawnix") && Path::new(&path).is_file() {
        Some(path)
    } else {
        None
    }
}

#[tauri::command]
pub fn default_board_path(app: AppHandle) -> Result<String, String> {
    let documents = app.path().document_dir().map_err(|error| error.to_string())?;
    let directory = documents.join("Drawnix");
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    Ok(directory
        .join("未命名.drawnix")
        .to_string_lossy()
        .into_owned())
}