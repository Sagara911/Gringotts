//! 缩略图与主色调：为素材生成 400px 缓存缩略图并提取主色。
//! 进度通过 "thumb-progress" 事件推给前端。

use std::collections::HashMap;

use tauri::Emitter;

use crate::db::{open_db, thumbs_dir, VIDEO_FORMATS_SQL};

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

/// 为缺缩略图或缺主色的素材补齐缩略图(400px PNG)与主色调。返回本次处理数量。
#[tauri::command]
pub fn build_thumbnails(app: tauri::AppHandle) -> Result<usize, String> {
    let dir = thumbs_dir(&app)?;
    let conn = open_db(&app)?;

    let todo: Vec<(i64, String, String)> = {
        let mut stmt = conn
            .prepare(&format!(
                "SELECT id,path,COALESCE(thumb,'') FROM assets
                 WHERE (thumb IS NULL OR thumb='' OR colors IS NULL OR colors='')
                 AND UPPER(COALESCE(format,'')) NOT IN {VIDEO_FORMATS_SQL}"
            ))
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

    let total = todo.len();
    let mut done = 0usize;
    let mut seen = 0usize;
    for (id, path, thumb) in todo {
        seen += 1;
        if seen % 3 == 0 || seen == total {
            let _ = app.emit(
                "thumb-progress",
                serde_json::json!({ "done": seen, "total": total }),
            );
        }
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
