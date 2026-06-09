use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use base64::Engine;
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
    /// 缓存缩略图的绝对路径（可能为空，前端回退到原图）
    thumb: String,
    /// 主色调（hex 数组，第一个为最主要色）
    colors: Vec<String>,
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
            thumb TEXT,
            colors TEXT,
            embed_model_version TEXT
        );",
    )
    .map_err(|e| e.to_string())?;
    // 旧库迁移：补列（已存在则报错，忽略即可）
    let _ = conn.execute("ALTER TABLE assets ADD COLUMN thumb TEXT", []);
    let _ = conn.execute("ALTER TABLE assets ADD COLUMN colors TEXT", []);
    Ok(conn)
}

/// 缩略图缓存目录
fn thumbs_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("thumbnails");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// 从图像中提取主色调（量化到 8 级/通道，取出现最多的几个桶）
fn dominant_colors(img: &image::DynamicImage) -> Vec<String> {
    let small = img.thumbnail(48, 48).to_rgb8();
    let mut counts: HashMap<(u8, u8, u8), u32> = HashMap::new();
    for p in small.pixels() {
        let key = (p[0] >> 5, p[1] >> 5, p[2] >> 5);
        *counts.entry(key).or_insert(0) += 1;
    }
    let mut v: Vec<((u8, u8, u8), u32)> = counts.into_iter().collect();
    v.sort_by(|a, b| b.1.cmp(&a.1));
    v.into_iter()
        .take(5)
        .map(|((r, g, b), _)| {
            // 还原成桶中心代表色
            let rr = (r << 5) | 16;
            let gg = (g << 5) | 16;
            let bb = (b << 5) | 16;
            format!("#{:02x}{:02x}{:02x}", rr, gg, bb)
        })
        .collect()
}

/// 公共查询：读出全部素材
fn fetch_assets(conn: &Connection) -> Result<Vec<Asset>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id,path,name,format,width,height,size_bytes,folder,source,author,tags,added_at,thumb,colors
             FROM assets ORDER BY added_at DESC, id DESC",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            let tags_json: String = row.get(10).unwrap_or_else(|_| "[]".to_string());
            let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();
            let colors_json: String = row.get(13).unwrap_or_else(|_| "[]".to_string());
            let colors: Vec<String> = serde_json::from_str(&colors_json).unwrap_or_default();
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
                thumb: row.get(12).unwrap_or_default(),
                colors,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
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

/// 返回库中所有素材
#[tauri::command]
fn list_assets(app: tauri::AppHandle) -> Result<Vec<Asset>, String> {
    let conn = open_db(&app)?;
    fetch_assets(&conn)
}

/// 清空库（开发期方便重置）
#[tauri::command]
fn clear_assets(app: tauri::AppHandle) -> Result<(), String> {
    let conn = open_db(&app)?;
    conn.execute("DELETE FROM assets", [])
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// 为缺缩略图或缺主色的素材补齐缩略图(400px PNG)与主色调。返回本次处理数量。
#[tauri::command]
fn build_thumbnails(app: tauri::AppHandle) -> Result<usize, String> {
    let dir = thumbs_dir(&app)?;
    let conn = open_db(&app)?;

    let todo: Vec<(i64, String, String)> = {
        let mut stmt = conn
            .prepare(
                "SELECT id,path,COALESCE(thumb,'') FROM assets
                 WHERE thumb IS NULL OR thumb='' OR colors IS NULL OR colors=''",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        rows.filter_map(|r| r.ok()).collect()
    };

    let mut done = 0usize;
    for (id, path, thumb) in todo {
        let mut thumb_str = thumb.clone();
        // 优先用已有缩略图（小图、解码快）来算主色；没有则解码原图并生成缩略图
        let work: Option<image::DynamicImage> =
            if !thumb.is_empty() && std::path::Path::new(&thumb).exists() {
                image::open(&thumb).ok()
            } else if let Ok(img) = image::open(&path) {
                let t = img.thumbnail(400, 400);
                let tp = dir.join(format!("{id}.png"));
                if t.save(&tp).is_ok() {
                    thumb_str = tp.to_string_lossy().to_string();
                }
                Some(t)
            } else {
                None
            };

        if let Some(im) = work {
            let colors = dominant_colors(&im);
            let cj = serde_json::to_string(&colors).unwrap_or_else(|_| "[]".to_string());
            let _ = conn.execute(
                "UPDATE assets SET thumb=?1, colors=?2 WHERE id=?3",
                rusqlite::params![thumb_str, cj, id],
            );
            done += 1;
        }
    }
    Ok(done)
}

/// 覆盖设置某素材的标签
#[tauri::command]
fn set_tags(app: tauri::AppHandle, id: i64, tags: Vec<String>) -> Result<(), String> {
    let conn = open_db(&app)?;
    let cj = serde_json::to_string(&tags).map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE assets SET tags=?1 WHERE id=?2",
        rusqlite::params![cj, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// 批量给多个素材添加同一个标签
#[tauri::command]
fn add_tag_bulk(app: tauri::AppHandle, ids: Vec<i64>, tag: String) -> Result<(), String> {
    let t = tag.trim().to_string();
    if t.is_empty() {
        return Ok(());
    }
    let conn = open_db(&app)?;
    for id in ids {
        let cur: String = conn
            .query_row(
                "SELECT COALESCE(tags,'[]') FROM assets WHERE id=?1",
                rusqlite::params![id],
                |r| r.get(0),
            )
            .unwrap_or_else(|_| "[]".to_string());
        let mut tags: Vec<String> = serde_json::from_str(&cur).unwrap_or_default();
        if !tags.contains(&t) {
            tags.push(t.clone());
        }
        let cj = serde_json::to_string(&tags).unwrap_or_else(|_| "[]".to_string());
        let _ = conn.execute(
            "UPDATE assets SET tags=?1 WHERE id=?2",
            rusqlite::params![cj, id],
        );
    }
    Ok(())
}

fn csv_escape(s: &str) -> String {
    if s.contains(',') || s.contains('"') || s.contains('\n') {
        format!("\"{}\"", s.replace('"', "\"\""))
    } else {
        s.to_string()
    }
}

/// 导出全部素材元数据到指定路径（json / csv）。返回导出条数。体现"数据不锁定"。
#[tauri::command]
fn export_metadata(app: tauri::AppHandle, path: String, format: String) -> Result<usize, String> {
    let conn = open_db(&app)?;
    let assets = fetch_assets(&conn)?;

    let content = if format.to_lowercase() == "csv" {
        let mut s =
            String::from("id,name,format,width,height,size_bytes,folder,source,author,tags,path\n");
        for a in &assets {
            let tags = a.tags.join("|");
            s.push_str(&format!(
                "{},{},{},{},{},{},{},{},{},{},{}\n",
                a.id,
                csv_escape(&a.name),
                a.format,
                a.width,
                a.height,
                a.size_bytes,
                csv_escape(&a.folder),
                csv_escape(&a.source),
                csv_escape(&a.author),
                csv_escape(&tags),
                csv_escape(&a.path),
            ));
        }
        s
    } else {
        serde_json::to_string_pretty(&assets).map_err(|e| e.to_string())?
    };

    fs::write(&path, content).map_err(|e| e.to_string())?;
    Ok(assets.len())
}

// ===== AI（Vision Provider，默认本地 Ollama，OpenAI 兼容，可用环境变量覆盖）=====

fn image_data_uri(path: &str) -> Result<String, String> {
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    let lower = path.to_lowercase();
    let mime = if lower.ends_with(".jpg") || lower.ends_with(".jpeg") {
        "image/jpeg"
    } else if lower.ends_with(".webp") {
        "image/webp"
    } else {
        "image/png"
    };
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(format!("data:{};base64,{}", mime, b64))
}

/// (base_url, model, api_key)；默认本地 Ollama，可用环境变量覆盖以接入 DeepSeek/GPT 等
fn ai_config() -> (String, String, String) {
    let base = std::env::var("GRINGOTTS_AI_BASE")
        .unwrap_or_else(|_| "http://localhost:11434/v1".to_string());
    let model = std::env::var("GRINGOTTS_AI_MODEL").unwrap_or_else(|_| "gemma4:12b".to_string());
    let key = std::env::var("GRINGOTTS_AI_KEY").unwrap_or_else(|_| "ollama".to_string());
    (base, model, key)
}

/// 对某素材跑一次视觉模型。mode: "tags" | "prompt" | "describe"。
/// tags 模式会把结果合并写回标签。返回模型文本。
#[tauri::command]
async fn ai_run(app: tauri::AppHandle, id: i64, mode: String) -> Result<String, String> {
    // 取图片路径（优先缩略图，体积小、推理快）
    let img_path: String = {
        let conn = open_db(&app)?;
        conn.query_row(
            "SELECT COALESCE(NULLIF(thumb,''), path) FROM assets WHERE id=?1",
            rusqlite::params![id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?
    };
    let data_uri = image_data_uri(&img_path)?;

    let prompt = match mode.as_str() {
        "tags" => "请用中文为这张图片生成 6-10 个简短标签，覆盖：题材/主体、风格、场景、配色、明暗氛围。只输出标签本身，用英文逗号 , 分隔，不要编号、不要解释。",
        "prompt" => "Generate a single Stable Diffusion / Midjourney style prompt (comma-separated English keywords) describing this reference image: subject, style, lighting, composition, camera, quality. Output ONLY the prompt text.",
        _ => "用中文分析这张画面：构图、打光、配色、风格特点。简明扼要，分点列出。",
    };

    let (base, model, key) = ai_config();
    let url = format!("{}/chat/completions", base.trim_end_matches('/'));
    let body = serde_json::json!({
        "model": model,
        "stream": false,
        "messages": [{
            "role": "user",
            "content": [
                {"type": "text", "text": prompt},
                {"type": "image_url", "image_url": {"url": data_uri}}
            ]
        }]
    });

    let client = reqwest::Client::new();
    let resp = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", key))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("请求 AI 服务失败：{e}（确认 Ollama 在运行）"))?;
    if !resp.status().is_success() {
        let st = resp.status();
        let t = resp.text().await.unwrap_or_default();
        return Err(format!("AI 服务返回 {st}: {t}"));
    }
    let v: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    let content = v["choices"][0]["message"]["content"]
        .as_str()
        .unwrap_or("")
        .trim()
        .to_string();
    if content.is_empty() {
        return Err("AI 返回空结果".to_string());
    }

    // tags 模式：解析并合并写回
    if mode == "tags" {
        let new_tags: Vec<String> = content
            .split(|c| c == ',' || c == '，' || c == '、' || c == '\n')
            .map(|s| {
                s.trim()
                    .trim_matches(|c| c == '#' || c == '-' || c == '*' || c == '.')
                    .trim()
                    .to_string()
            })
            .filter(|s| !s.is_empty() && s.chars().count() <= 12)
            .collect();
        let conn = open_db(&app)?;
        let cur: String = conn
            .query_row(
                "SELECT COALESCE(tags,'[]') FROM assets WHERE id=?1",
                rusqlite::params![id],
                |r| r.get(0),
            )
            .unwrap_or_else(|_| "[]".to_string());
        let mut tags: Vec<String> = serde_json::from_str(&cur).unwrap_or_default();
        for t in new_tags {
            if !tags.contains(&t) {
                tags.push(t);
            }
        }
        let cj = serde_json::to_string(&tags).unwrap_or_else(|_| "[]".to_string());
        let _ = conn.execute(
            "UPDATE assets SET tags=?1 WHERE id=?2",
            rusqlite::params![cj, id],
        );
    }

    Ok(content)
}

/// 批量给多张素材跑 Gemma 自动打标。返回成功数量。
#[tauri::command]
async fn ai_tag_bulk(app: tauri::AppHandle, ids: Vec<i64>) -> Result<usize, String> {
    let mut ok = 0usize;
    for id in ids {
        if ai_run(app.clone(), id, "tags".to_string()).await.is_ok() {
            ok += 1;
        }
    }
    Ok(ok)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            import_folder,
            list_assets,
            clear_assets,
            build_thumbnails,
            set_tags,
            add_tag_bulk,
            export_metadata,
            ai_run,
            ai_tag_bulk
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
