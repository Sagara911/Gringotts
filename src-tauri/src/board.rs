//! 画板持久化：tldraw 快照存入我们的 SQLite。
//! 地基原则：用户数据不能只活在某个 UI 库的私有存储里 ——
//! tldraw 的本地存储只当快取，这里才是权威副本（见 ARCHITECTURE.md 倒置风险 #2）。

use crate::db::{now_secs, open_db};

/// 保存画板快照（目前单画板，id=1；将来多画板扩展 name/id 即可）
#[tauri::command]
pub fn save_board(app: tauri::AppHandle, snapshot: String) -> Result<(), String> {
    let conn = open_db(&app)?;
    conn.execute(
        "INSERT INTO boards(id,name,snapshot,updated_at) VALUES(1,'默认画板',?1,?2)
         ON CONFLICT(id) DO UPDATE SET snapshot=?1, updated_at=?2",
        rusqlite::params![snapshot, now_secs()],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// 读取画板快照（无则 None）
#[tauri::command]
pub fn load_board(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let conn = open_db(&app)?;
    let r = conn.query_row("SELECT snapshot FROM boards WHERE id=1", [], |r| {
        r.get::<_, String>(0)
    });
    match r {
        Ok(s) if !s.is_empty() => Ok(Some(s)),
        _ => Ok(None),
    }
}
