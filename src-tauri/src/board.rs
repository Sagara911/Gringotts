//! 画板持久化：自研画布快照存入 SQLite（多画板）。
//! 地基原则：用户数据不能只活在前端的私有存储里 ——
//! localStorage 只当快取，这里才是权威副本（见 ARCHITECTURE.md 倒置风险 #2）。

use base64::Engine;
use serde::Serialize;

use crate::db::{now_secs, open_db};

#[derive(Serialize)]
pub struct BoardMeta {
    pub id: i64,
    pub name: String,
    pub updated_at: i64,
}

/// 画板列表（库里一块都没有时自动建默认画板，保证永远至少一块）
#[tauri::command]
pub fn list_boards(app: tauri::AppHandle) -> Result<Vec<BoardMeta>, String> {
    let conn = open_db(&app)?;
    let mut stmt = conn
        .prepare("SELECT id, COALESCE(name,'画板'), COALESCE(updated_at,0) FROM boards ORDER BY id")
        .map_err(|e| e.to_string())?;
    let mut rows: Vec<BoardMeta> = stmt
        .query_map([], |r| {
            Ok(BoardMeta {
                id: r.get(0)?,
                name: r.get(1)?,
                updated_at: r.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    if rows.is_empty() {
        conn.execute(
            "INSERT INTO boards(id,name,snapshot,updated_at) VALUES(1,'默认画板','',?1)",
            rusqlite::params![now_secs()],
        )
        .map_err(|e| e.to_string())?;
        rows.push(BoardMeta {
            id: 1,
            name: "默认画板".into(),
            updated_at: now_secs(),
        });
    }
    Ok(rows)
}

/// 新建画板，返回 id
#[tauri::command]
pub fn create_board(app: tauri::AppHandle, name: String) -> Result<i64, String> {
    let conn = open_db(&app)?;
    conn.execute(
        "INSERT INTO boards(name,snapshot,updated_at) VALUES(?1,'',?2)",
        rusqlite::params![name, now_secs()],
    )
    .map_err(|e| e.to_string())?;
    Ok(conn.last_insert_rowid())
}

#[tauri::command]
pub fn rename_board(app: tauri::AppHandle, id: i64, name: String) -> Result<(), String> {
    let conn = open_db(&app)?;
    conn.execute(
        "UPDATE boards SET name=?2 WHERE id=?1",
        rusqlite::params![id, name],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_board(app: tauri::AppHandle, id: i64) -> Result<(), String> {
    let conn = open_db(&app)?;
    conn.execute("DELETE FROM boards WHERE id=?1", rusqlite::params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// 保存画板快照（只更新 snapshot，不动 name）
#[tauri::command]
pub fn save_board(app: tauri::AppHandle, id: i64, snapshot: String) -> Result<(), String> {
    let conn = open_db(&app)?;
    conn.execute(
        "INSERT INTO boards(id,name,snapshot,updated_at) VALUES(?1,'画板',?2,?3)
         ON CONFLICT(id) DO UPDATE SET snapshot=?2, updated_at=?3",
        rusqlite::params![id, snapshot, now_secs()],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// 读取画板快照（无则 None）
#[tauri::command]
pub fn load_board(app: tauri::AppHandle, id: i64) -> Result<Option<String>, String> {
    let conn = open_db(&app)?;
    let r = conn.query_row(
        "SELECT snapshot FROM boards WHERE id=?1",
        rusqlite::params![id],
        |r| r.get::<_, String>(0),
    );
    match r {
        Ok(s) if !s.is_empty() => Ok(Some(s)),
        _ => Ok(None),
    }
}

/// 写出二进制文件（导出 PNG 等；路径来自系统保存对话框，由用户选定）
#[tauri::command]
pub fn save_file(path: String, data_b64: String) -> Result<(), String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&data_b64)
        .map_err(|e| e.to_string())?;
    std::fs::write(&path, bytes).map_err(|e| e.to_string())
}
