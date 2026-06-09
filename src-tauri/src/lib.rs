use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::Connection;
use serde::Serialize;
use tauri::Manager;
use walkdir::WalkDir;

/// 单条素材的元数据（序列化成 camelCase 给前端）
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Asset {
    id: i64,
    path: String,
    name: String,
    format: String,
    width: i64,
    height: i64,
    size_bytes: i64,
    folder: String,
    source: String,
    author: String,
    tags: Vec<String>,
    added_at: i64,
}

const IMAGE_EXTS: &[&str] = &[
    "jpg", "jpeg", "png", "gif", "webp", "bmp", "tif", "tiff", "avif",
];

fn db_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("gringotts.sqlite"))
}

fn open_db(app: &tauri::AppHandle) -> Result<Connection, String> {
    let conn = Connection::open(db_path(app)?).map_err(|e| e.to_string())?;
    // 预留 embed_model_version 字段给后续向量检索（换嵌入模型时识别并重建索引）
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS assets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            path TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL,
            format TEXT,
            width INTEGER,
            height INTEGER,
            size_bytes INTEGER,
            folder TEXT,
            source TEXT,
            author TEXT,
            tags TEXT,
            added_at INTEGER,
            embed_model_version TEXT
        );",
    )
    .map_err(|e| e.to_string())?;
    Ok(conn)
}

fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// 扫描文件夹（递归），把图片文件入库。返回本次新增数量。
#[tauri::command]
fn import_folder(app: tauri::AppHandle, path: String) -> Result<usize, String> {
    let conn = open_db(&app)?;
    let now = now_secs();
    let mut added = 0usize;

    for entry in WalkDir::new(&path).into_iter().filter_map(|e| e.ok()) {
        if !entry.file_type().is_file() {
            continue;
        }
        let p = entry.path();
        let ext = p
            .extension()
            .and_then(|s| s.to_str())
            .map(|s| s.to_lowercase())
            .unwrap_or_default();
        if !IMAGE_EXTS.contains(&ext.as_str()) {
            continue;
        }

        let (w, h) = match imagesize::size(p) {
            Ok(sz) => (sz.width as i64, sz.height as i64),
            Err(_) => (0, 0),
        };
        let size_bytes = entry.metadata().map(|m| m.len() as i64).unwrap_or(0);
        let name = p
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_string();
        let folder = p
            .parent()
            .and_then(|s| s.file_name())
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_string();
        let path_str = p.to_string_lossy().to_string();

        // INSERT OR IGNORE：path 唯一，重复导入不会产生重复记录
        let changed = conn
            .execute(
                "INSERT OR IGNORE INTO assets
                 (path,name,format,width,height,size_bytes,folder,source,author,tags,added_at)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
                rusqlite::params![
                    path_str,
                    name,
                    ext.to_uppercase(),
                    w,
                    h,
                    size_bytes,
                    folder,
                    "本地",
                    "",
                    "[]",
                    now
                ],
            )
            .map_err(|e| e.to_string())?;
        added += changed;
    }

    Ok(added)
}

/// 返回库中所有素材（按导入时间倒序）
#[tauri::command]
fn list_assets(app: tauri::AppHandle) -> Result<Vec<Asset>, String> {
    let conn = open_db(&app)?;
    let mut stmt = conn
        .prepare(
            "SELECT id,path,name,format,width,height,size_bytes,folder,source,author,tags,added_at
             FROM assets ORDER BY added_at DESC, id DESC",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            let tags_json: String = row.get(10).unwrap_or_else(|_| "[]".to_string());
            let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();
            Ok(Asset {
                id: row.get(0)?,
                path: row.get(1)?,
                name: row.get(2)?,
                format: row.get(3).unwrap_or_default(),
                width: row.get(4).unwrap_or(0),
                height: row.get(5).unwrap_or(0),
                size_bytes: row.get(6).unwrap_or(0),
                folder: row.get(7).unwrap_or_default(),
                source: row.get(8).unwrap_or_default(),
                author: row.get(9).unwrap_or_default(),
                tags,
                added_at: row.get(11).unwrap_or(0),
            })
        })
        .map_err(|e| e.to_string())?;

    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

/// 清空库（开发期方便重置）
#[tauri::command]
fn clear_assets(app: tauri::AppHandle) -> Result<(), String> {
    let conn = open_db(&app)?;
    conn.execute("DELETE FROM assets", [])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            import_folder,
            list_assets,
            clear_assets
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
