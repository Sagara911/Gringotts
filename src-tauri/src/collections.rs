//! 合集（用户手攒的素材集合）：画板情绪板可一键存回库，库内可按合集筛选。
//! 数据走 collections + collection_items 两张表（建表在 db.rs 迁移区）。
//! 与标签的区别：合集是有序/具名的成组收藏，不污染 tags 体系。

use crate::db::{now_secs, open_db};

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Collection {
    id: i64,
    name: String,
    count: i64,
    created_at: i64,
}

/// 列出全部合集（带成员数，按创建时间倒序）
#[tauri::command]
pub fn list_collections(app: tauri::AppHandle) -> Result<Vec<Collection>, String> {
    let conn = open_db(&app)?;
    let mut stmt = conn
        .prepare(
            "SELECT c.id, c.name, COALESCE(c.created_at,0),
                    (SELECT COUNT(*) FROM collection_items ci WHERE ci.collection_id=c.id)
             FROM collections c ORDER BY c.created_at DESC, c.id DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(Collection {
                id: r.get(0)?,
                name: r.get(1)?,
                created_at: r.get(2)?,
                count: r.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

/// 新建合集并写入初始成员，返回新合集 id
#[tauri::command]
pub fn create_collection(
    app: tauri::AppHandle,
    name: String,
    asset_ids: Vec<i64>,
) -> Result<i64, String> {
    let n = name.trim();
    if n.is_empty() {
        return Err("合集名称不能为空".into());
    }
    let conn = open_db(&app)?;
    let now = now_secs();
    conn.execute(
        "INSERT INTO collections(name, created_at) VALUES(?1, ?2)",
        rusqlite::params![n, now],
    )
    .map_err(|e| e.to_string())?;
    let id = conn.last_insert_rowid();
    insert_items(&conn, id, &asset_ids, now);
    Ok(id)
}

/// 往已有合集追加成员，返回新增数量（去重，已在的不重复计）
#[tauri::command]
pub fn add_to_collection(
    app: tauri::AppHandle,
    id: i64,
    asset_ids: Vec<i64>,
) -> Result<usize, String> {
    let conn = open_db(&app)?;
    Ok(insert_items(&conn, id, &asset_ids, now_secs()))
}

/// 从合集移除成员（不删素材本身）
#[tauri::command]
pub fn remove_from_collection(
    app: tauri::AppHandle,
    id: i64,
    asset_ids: Vec<i64>,
) -> Result<(), String> {
    let conn = open_db(&app)?;
    for aid in asset_ids {
        let _ = conn.execute(
            "DELETE FROM collection_items WHERE collection_id=?1 AND asset_id=?2",
            rusqlite::params![id, aid],
        );
    }
    Ok(())
}

/// 删除整个合集（连同成员关系；不删素材本身）
#[tauri::command]
pub fn delete_collection(app: tauri::AppHandle, id: i64) -> Result<(), String> {
    let conn = open_db(&app)?;
    let _ = conn.execute(
        "DELETE FROM collection_items WHERE collection_id=?1",
        rusqlite::params![id],
    );
    conn.execute("DELETE FROM collections WHERE id=?1", rusqlite::params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// 重命名合集
#[tauri::command]
pub fn rename_collection(app: tauri::AppHandle, id: i64, name: String) -> Result<(), String> {
    let n = name.trim();
    if n.is_empty() {
        return Err("合集名称不能为空".into());
    }
    let conn = open_db(&app)?;
    conn.execute(
        "UPDATE collections SET name=?1 WHERE id=?2",
        rusqlite::params![n, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// 取某合集的成员 asset id（按加入顺序）
#[tauri::command]
pub fn collection_asset_ids(app: tauri::AppHandle, id: i64) -> Result<Vec<i64>, String> {
    let conn = open_db(&app)?;
    let mut stmt = conn
        .prepare(
            "SELECT asset_id FROM collection_items
             WHERE collection_id=?1 ORDER BY added_at, asset_id",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params![id], |r| r.get::<_, i64>(0))
        .map_err(|e| e.to_string())?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

/// 写入成员（INSERT OR IGNORE 去重），返回真正新增的条数
fn insert_items(conn: &rusqlite::Connection, id: i64, asset_ids: &[i64], now: i64) -> usize {
    let mut added = 0usize;
    for aid in asset_ids {
        added += conn
            .execute(
                "INSERT OR IGNORE INTO collection_items(collection_id, asset_id, added_at)
                 VALUES(?1, ?2, ?3)",
                rusqlite::params![id, aid, now],
            )
            .unwrap_or(0);
    }
    added
}
