#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod storage;

use tauri::{Emitter, Manager};

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
            }
            if let Some(path) = args.get(1) {
                let _ = app.emit("open-file", path.clone());
            }
        }))
        .invoke_handler(tauri::generate_handler![
            storage::pick_open,
            storage::pick_save,
            storage::read_file_base64,
            storage::write_file_base64,
            storage::read_file_text,
            storage::write_file_text,
            storage::file_exists,
            storage::read_app_state,
            storage::write_app_state,
            storage::default_board_path,
            storage::launch_file_path,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Drawnix");
}