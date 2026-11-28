use std::fs;
use std::io::{BufWriter, Read, Write};
use std::path::{Path, PathBuf};

use base64::Engine;
use chrono::Local;
use flate2::{read::GzDecoder, write::GzEncoder, Compression};
use serde::{Deserialize, Serialize};
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

fn gzip_write_atomic(path: &Path, contents: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let mut temporary = path.as_os_str().to_owned();
    temporary.push(".tmp");
    let temporary = PathBuf::from(temporary);
    let file = fs::File::create(&temporary).map_err(|error| error.to_string())?;
    let mut encoder = GzEncoder::new(BufWriter::new(file), Compression::new(6));
    encoder
        .write_all(contents.as_bytes())
        .map_err(|error| error.to_string())?;
    encoder.finish().map_err(|error| error.to_string())?;
    fs::rename(&temporary, path).map_err(|error| error.to_string())
}

fn gzip_read(path: &Path) -> Result<String, String> {
    let file = fs::File::open(path).map_err(|error| error.to_string())?;
    let mut decoder = GzDecoder::new(file);
    let mut contents = String::new();
    decoder
        .read_to_string(&mut contents)
        .map_err(|error| error.to_string())?;
    Ok(contents)
}

#[derive(Serialize)]
pub struct CreatedMindMap {
    folder_path: String,
    file_path: String,
}

#[tauri::command]
pub fn create_mind_map(app: AppHandle, contents: String) -> Result<CreatedMindMap, String> {
    let documents = app.path().document_dir().map_err(|error| error.to_string())?;
    let root = documents.join("Drawnix");
    fs::create_dir_all(&root).map_err(|error| error.to_string())?;
    let date = Local::now().format("%Y%m%d").to_string();
    let mut folder = None;
    for sequence in 1..=100_000u32 {
        let name = if sequence == 1 {
            date.clone()
        } else {
            format!("{date}-{sequence}")
        };
        let candidate = root.join(name);
        match fs::create_dir(&candidate) {
            Ok(()) => {
                folder = Some(candidate);
                break;
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error.to_string()),
        }
    }
    let folder = folder.ok_or_else(|| "无法创建导图文件夹".to_string())?;
    let file = folder.join("1");
    if let Err(error) = gzip_write_atomic(&file, &contents) {
        let _ = fs::remove_dir_all(&folder);
        return Err(error);
    }
    Ok(CreatedMindMap {
        folder_path: folder.to_string_lossy().into_owned(),
        file_path: file.to_string_lossy().into_owned(),
    })
}

#[tauri::command]
pub fn save_board_version(
    folder_path: String,
    version: u32,
    contents: String,
) -> Result<(), String> {
    if version < 2 {
        return Err("版本序号必须从 2 开始".to_string());
    }
    let file = Path::new(&folder_path).join(version.to_string());
    if file.exists() {
        return Err("版本已存在，不能覆盖".to_string());
    }
    gzip_write_atomic(&file, &contents)
}

#[tauri::command]
pub fn read_board_version(path: String) -> Result<String, String> {
    gzip_read(Path::new(&path))
}

fn modified_ms(metadata: &fs::Metadata) -> u64 {
    metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn version_entries(folder: &Path) -> Result<Vec<(u32, PathBuf)>, String> {
    let read_dir = match fs::read_dir(folder) {
        Ok(read_dir) => read_dir,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(error.to_string()),
    };
    let mut entries = Vec::new();
    for entry in read_dir {
        let entry = entry.map_err(|error| error.to_string())?;
        let file_type = entry.file_type().map_err(|error| error.to_string())?;
        if !file_type.is_file() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        if let Ok(version) = name.parse::<u32>() {
            entries.push((version, entry.path()));
        }
    }
    entries.sort_by(|a, b| b.0.cmp(&a.0));
    Ok(entries)
}

#[derive(Serialize)]
pub struct BoardVersionInfo {
    version: u32,
    size: u64,
    modified_ms: u64,
}

#[tauri::command]
pub fn list_board_versions(folder_path: String) -> Result<Vec<BoardVersionInfo>, String> {
    let mut versions = Vec::new();
    for (version, path) in version_entries(Path::new(&folder_path))? {
        let metadata = fs::metadata(&path).map_err(|error| error.to_string())?;
        versions.push(BoardVersionInfo {
            version,
            size: metadata.len(),
            modified_ms: modified_ms(&metadata),
        });
    }
    Ok(versions)
}

#[tauri::command]
pub fn delete_board_version(folder_path: String, version: u32) -> Result<(), String> {
    let folder = Path::new(&folder_path);
    let entries = version_entries(folder)?;
    if entries.first().map(|(latest, _)| *latest) == Some(version) {
        return Err("不能删除最新版本".to_string());
    }
    let path = folder.join(version.to_string());
    if !path.is_file() {
        return Err("版本不存在".to_string());
    }
    fs::remove_file(path).map_err(|error| error.to_string())
}

fn is_date_folder(name: &str) -> bool {
    let mut parts = name.split('-');
    let date = parts.next().unwrap_or("");
    if date.len() != 8 || !date.bytes().all(|byte| byte.is_ascii_digit()) {
        return false;
    }
    let sequence = match parts.next() {
        None => return true,
        Some(sequence) => sequence,
    };
    if parts.next().is_some() {
        return false;
    }
    !sequence.is_empty() && sequence.bytes().all(|byte| byte.is_ascii_digit())
}

#[derive(Serialize)]
pub struct RecentMapInfo {
    folder_path: String,
    name: String,
    latest_version: u32,
    version_count: usize,
    modified_ms: u64,
}

fn drawnix_root(app: &AppHandle) -> Result<PathBuf, String> {
    let documents = app.path().document_dir().map_err(|error| error.to_string())?;
    Ok(documents.join("Drawnix"))
}

fn map_folders(root: &Path) -> Result<Vec<(String, PathBuf)>, String> {
    let read_dir = match fs::read_dir(root) {
        Ok(read_dir) => read_dir,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(error.to_string()),
    };
    let mut folders = Vec::new();
    for entry in read_dir {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        if is_date_folder(&name) {
            folders.push((name, path));
        }
    }
    Ok(folders)
}

#[derive(Serialize, Default)]
pub struct StorageStats {
    map_count: usize,
    version_count: usize,
    total_bytes: u64,
}

#[derive(Serialize, Default)]
pub struct StorageCleanupInfo {
    map_count: usize,
    version_count: usize,
    freed_bytes: u64,
}

#[tauri::command]
pub fn get_storage_stats(app: AppHandle) -> Result<StorageStats, String> {
    let mut stats = StorageStats::default();
    for (_, folder) in map_folders(&drawnix_root(&app)?)? {
        let entries = version_entries(&folder)?;
        if entries.is_empty() {
            continue;
        }
        stats.map_count += 1;
        for (_, path) in entries {
            let metadata = fs::metadata(&path).map_err(|error| error.to_string())?;
            stats.version_count += 1;
            stats.total_bytes += metadata.len();
        }
    }
    Ok(stats)
}

fn cleanup_plan(root: &Path, keep_latest: usize) -> Result<(Vec<PathBuf>, StorageCleanupInfo), String> {
    if keep_latest == 0 {
        return Err("至少需要保留 1 个版本".to_string());
    }
    let mut files = Vec::new();
    let mut info = StorageCleanupInfo::default();
    for (_, folder) in map_folders(root)? {
        let entries = version_entries(&folder)?;
        let mut affected = false;
        for (_, path) in entries.into_iter().skip(keep_latest) {
            let metadata = fs::metadata(&path).map_err(|error| error.to_string())?;
            info.version_count += 1;
            info.freed_bytes += metadata.len();
            files.push(path);
            affected = true;
        }
        if affected {
            info.map_count += 1;
        }
    }
    Ok((files, info))
}

#[tauri::command]
pub fn preview_storage_cleanup(
    app: AppHandle,
    keep_latest: usize,
) -> Result<StorageCleanupInfo, String> {
    let (_, info) = cleanup_plan(&drawnix_root(&app)?, keep_latest)?;
    Ok(info)
}

fn apply_cleanup(root: &Path, keep_latest: usize) -> Result<StorageCleanupInfo, String> {
    let (files, info) = cleanup_plan(root, keep_latest)?;
    for path in files {
        fs::remove_file(path).map_err(|error| error.to_string())?;
    }
    Ok(info)
}

#[tauri::command]
pub fn cleanup_storage(app: AppHandle, keep_latest: usize) -> Result<StorageCleanupInfo, String> {
    apply_cleanup(&drawnix_root(&app)?, keep_latest)
}

#[tauri::command]
pub fn list_recent_maps(app: AppHandle, limit: usize) -> Result<Vec<RecentMapInfo>, String> {
    let mut maps = Vec::new();
    for (name, path) in map_folders(&drawnix_root(&app)?)? {
        let entries = version_entries(&path)?;
        let Some((latest_version, latest_path)) = entries.first() else {
            continue;
        };
        let metadata = fs::metadata(latest_path).map_err(|error| error.to_string())?;
        maps.push(RecentMapInfo {
            folder_path: path.to_string_lossy().into_owned(),
            name,
            latest_version: *latest_version,
            version_count: entries.len(),
            modified_ms: modified_ms(&metadata),
        });
    }
    maps.sort_by(|a, b| b.modified_ms.cmp(&a.modified_ms));
    maps.truncate(limit);
    Ok(maps)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_folder(name: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!("drawnix-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&path);
        fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn version_entries_only_include_files() {
        let folder = test_folder("version-entries");
        fs::write(folder.join("1"), "one").unwrap();
        fs::write(folder.join("2"), "two").unwrap();
        fs::write(folder.join("notes"), "ignore").unwrap();
        fs::create_dir(folder.join("3")).unwrap();

        let versions = version_entries(&folder).unwrap();
        assert_eq!(
            versions.iter().map(|(version, _)| *version).collect::<Vec<_>>(),
            vec![2, 1]
        );

        fs::remove_dir_all(folder).unwrap();
    }

    #[test]
    fn save_board_version_rejects_overwrite() {
        let folder = test_folder("version-overwrite");
        save_board_version(folder.to_string_lossy().into_owned(), 2, "first".to_string()).unwrap();

        let error = save_board_version(folder.to_string_lossy().into_owned(), 2, "second".to_string())
            .unwrap_err();
        assert!(error.contains("不能覆盖"));
        assert_eq!(
            read_board_version(folder.join("2").to_string_lossy().into_owned()).unwrap(),
            "first"
        );

        fs::remove_dir_all(folder).unwrap();
    }

    #[test]
    fn cleanup_plan_keeps_latest_versions() {
        let root = test_folder("cleanup-plan");
        let first = root.join("20261128");
        let second = root.join("20261128-2");
        fs::create_dir(&first).unwrap();
        fs::create_dir(&second).unwrap();
        fs::write(first.join("1"), b"1").unwrap();
        fs::write(first.join("2"), b"22").unwrap();
        fs::write(first.join("3"), b"333").unwrap();
        fs::write(first.join("4"), b"4444").unwrap();
        fs::write(second.join("1"), b"11111").unwrap();
        fs::write(second.join("2"), b"22222").unwrap();

        let (files, info) = cleanup_plan(&root, 2).unwrap();

        assert_eq!(info.map_count, 1);
        assert_eq!(info.version_count, 2);
        assert_eq!(info.freed_bytes, 3);
        assert_eq!(files.len(), 2);
        assert!(files.iter().all(|path| path.parent() == Some(first.as_path())));
        assert!(first.join("3").is_file());
        assert!(first.join("4").is_file());
        assert!(second.join("1").is_file());
        assert!(second.join("2").is_file());

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn apply_cleanup_removes_only_old_versions() {
        let root = test_folder("cleanup-apply");
        let folder = root.join("20990101");
        fs::create_dir(&folder).unwrap();
        for version in 1..=4 {
            fs::write(folder.join(version.to_string()), b"x").unwrap();
        }

        let info = apply_cleanup(&root, 2).unwrap();

        assert_eq!(info.map_count, 1);
        assert_eq!(info.version_count, 2);
        assert_eq!(info.freed_bytes, 2);
        assert!(!folder.join("1").exists());
        assert!(!folder.join("2").exists());
        assert!(folder.join("3").is_file());
        assert!(folder.join("4").is_file());

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn cleanup_plan_requires_one_kept_version() {
        let root = test_folder("cleanup-plan-zero");
        assert!(cleanup_plan(&root, 0).is_err());
        fs::remove_dir_all(root).unwrap();
    }
}
