//! 检索：向量相似度计算与两套索引。
//! - CLIP（主力）：向量由前端 transformers.js 计算，本模块只存取与检索。
//!   将来把 CLIP 推理下沉到 Rust(ONNX) 时，只需在这里加一个"计算"实现，前端接口不变。
//! - 文本嵌入（旧链路）：Gemma caption → bge-m3，保留作为备用。

use serde::Serialize;

use crate::db::{open_db, MEDIA_FORMATS_SQL};
use crate::settings::embed_config;

pub(crate) fn cosine(a: &[f32], b: &[f32]) -> f32 {
    if a.len() != b.len() || a.is_empty() {
        return -1.0;
    }
    let (mut dot, mut na, mut nb) = (0.0f32, 0.0f32, 0.0f32);
    for i in 0..a.len() {
        dot += a[i] * b[i];
        na += a[i] * a[i];
        nb += b[i] * b[i];
    }
    if na == 0.0 || nb == 0.0 {
        return -1.0;
    }
    dot / (na.sqrt() * nb.sqrt())
}

// ===== 文本嵌入（旧链路，备用）=====

async fn embed_text(app: &tauri::AppHandle, text: &str) -> Result<Vec<f32>, String> {
    let (base, model, key) = embed_config(app);
    let url = format!("{}/embeddings", base.trim_end_matches('/'));
    let body = serde_json::json!({ "model": model, "input": text });
    let client = reqwest::Client::new();
    let resp = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", key))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("嵌入请求失败：{e}（确认 Ollama 在运行、已拉取 bge-m3）"))?;
    if !resp.status().is_success() {
        let st = resp.status();
        let t = resp.text().await.unwrap_or_default();
        return Err(format!("嵌入服务返回 {st}: {t}"));
    }
    let v: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    let arr = v["data"][0]["embedding"]
        .as_array()
        .ok_or("嵌入响应缺少 embedding")?;
    Ok(arr
        .iter()
        .filter_map(|x| x.as_f64().map(|f| f as f32))
        .collect())
}

fn load_embeddings(app: &tauri::AppHandle) -> Result<Vec<(i64, Vec<f32>)>, String> {
    let conn = open_db(app)?;
    let mut stmt = conn
        .prepare("SELECT id, embedding FROM assets WHERE embedding IS NOT NULL AND embedding!=''")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))
        .map_err(|e| e.to_string())?;
    Ok(rows
        .filter_map(|r| r.ok())
        .filter_map(|(id, ej)| serde_json::from_str::<Vec<f32>>(&ej).ok().map(|v| (id, v)))
        .collect())
}

/// 为缺向量（或换了嵌入模型）的素材建立语义索引：Gemma 生成描述 → bge-m3 转向量。返回处理数量。
#[tauri::command]
pub async fn build_embeddings(app: tauri::AppHandle) -> Result<usize, String> {
    let (_b, model, _k) = embed_config(&app);
    let todo: Vec<i64> = {
        let conn = open_db(&app)?;
        let mut stmt = conn
            .prepare(
                "SELECT id FROM assets
                 WHERE embedding IS NULL OR embedding='' OR embed_model_version IS NULL OR embed_model_version!=?1",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(rusqlite::params![model], |r| r.get::<_, i64>(0))
            .map_err(|e| e.to_string())?;
        rows.filter_map(|r| r.ok()).collect()
    };

    let mut done = 0usize;
    for id in todo {
        let caption = match crate::ai::ai_run(app.clone(), id, "caption".to_string()).await {
            Ok(c) => c,
            Err(_) => continue,
        };
        // 把文件名 + 已有标签也并入文本，让检索更全
        let extra: String = {
            let conn = open_db(&app)?;
            conn.query_row(
                "SELECT name || ' ' || COALESCE(tags,'') FROM assets WHERE id=?1",
                rusqlite::params![id],
                |r| r.get(0),
            )
            .unwrap_or_default()
        };
        let text = format!("{} {}", caption, extra);
        let emb = match embed_text(&app, &text).await {
            Ok(e) => e,
            Err(_) => continue,
        };
        let ej = serde_json::to_string(&emb).unwrap_or_else(|_| "[]".to_string());
        let conn = open_db(&app)?;
        let _ = conn.execute(
            "UPDATE assets SET caption=?1, embedding=?2, embed_model_version=?3 WHERE id=?4",
            rusqlite::params![caption, ej, model, id],
        );
        done += 1;
    }
    Ok(done)
}

/// 文字搜图：把 query 转向量，返回相似度最高的素材 id（已建索引者）
#[tauri::command]
pub async fn semantic_search(
    app: tauri::AppHandle,
    query: String,
    top: usize,
) -> Result<Vec<i64>, String> {
    let qv = embed_text(&app, &query).await?;
    let rows = load_embeddings(&app)?;
    let mut scored: Vec<(i64, f32)> = rows
        .into_iter()
        .map(|(id, v)| (id, cosine(&qv, &v)))
        .collect();
    scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    Ok(scored.into_iter().take(top.max(1)).map(|(id, _)| id).collect())
}

/// 找相似：以某素材的向量找最接近的其它素材
#[tauri::command]
pub fn similar_to(app: tauri::AppHandle, id: i64, top: usize) -> Result<Vec<i64>, String> {
    let rows = load_embeddings(&app)?;
    let target = rows
        .iter()
        .find(|(rid, _)| *rid == id)
        .map(|(_, v)| v.clone())
        .ok_or("该图还没建立语义索引，请先点「建立语义索引」")?;
    let mut scored: Vec<(i64, f32)> = rows
        .into_iter()
        .filter(|(rid, _)| *rid != id)
        .map(|(rid, v)| (rid, cosine(&target, &v)))
        .collect();
    scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    Ok(scored.into_iter().take(top.max(1)).map(|(id, _)| id).collect())
}

// ===== 内置 CLIP（前端 transformers.js 计算向量，后端只负责存取与检索）=====

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipTarget {
    id: i64,
    img: String,
}

fn load_clip(app: &tauri::AppHandle) -> Result<Vec<(i64, Vec<f32>)>, String> {
    let conn = open_db(app)?;
    let mut stmt = conn
        .prepare("SELECT id, clip_embedding FROM assets WHERE clip_embedding IS NOT NULL AND clip_embedding!=''")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))
        .map_err(|e| e.to_string())?;
    Ok(rows
        .filter_map(|r| r.ok())
        .filter_map(|(id, ej)| serde_json::from_str::<Vec<f32>>(&ej).ok().map(|v| (id, v)))
        .collect())
}

/// 返回还没有 CLIP 向量的素材（id + 用于计算的图片路径，优先缩略图）
#[tauri::command]
pub fn clip_targets(app: tauri::AppHandle) -> Result<Vec<ClipTarget>, String> {
    let conn = open_db(&app)?;
    let mut stmt = conn
        .prepare(&format!(
            "SELECT id, COALESCE(NULLIF(thumb,''), path) FROM assets
             WHERE (clip_embedding IS NULL OR clip_embedding='')
             AND UPPER(COALESCE(format,'')) NOT IN {MEDIA_FORMATS_SQL}"
        ))
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(ClipTarget {
                id: r.get(0)?,
                img: r.get(1)?,
            })
        })
        .map_err(|e| e.to_string())?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

/// 存一张图的 CLIP 向量
#[tauri::command]
pub fn set_clip_embedding(app: tauri::AppHandle, id: i64, vector: Vec<f32>) -> Result<(), String> {
    let conn = open_db(&app)?;
    let ej = serde_json::to_string(&vector).map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE assets SET clip_embedding=?1 WHERE id=?2",
        rusqlite::params![ej, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// 文字/以图搜图：传入查询向量（前端用 CLIP 算好），返回相似度最高的素材 id
#[tauri::command]
pub fn clip_search(app: tauri::AppHandle, vector: Vec<f32>, top: usize) -> Result<Vec<i64>, String> {
    let rows = load_clip(&app)?;
    let mut scored: Vec<(i64, f32)> = rows
        .into_iter()
        .map(|(id, v)| (id, cosine(&vector, &v)))
        .collect();
    scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    Ok(scored.into_iter().take(top.max(1)).map(|(id, _)| id).collect())
}

/// 以某素材的 CLIP 向量找最相似的其它素材
#[tauri::command]
pub fn clip_similar(app: tauri::AppHandle, id: i64, top: usize) -> Result<Vec<i64>, String> {
    let rows = load_clip(&app)?;
    let target = rows
        .iter()
        .find(|(rid, _)| *rid == id)
        .map(|(_, v)| v.clone())
        .ok_or("该图还没建立 CLIP 索引")?;
    let mut scored: Vec<(i64, f32)> = rows
        .into_iter()
        .filter(|(rid, _)| *rid != id)
        .map(|(rid, v)| (rid, cosine(&target, &v)))
        .collect();
    scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    Ok(scored.into_iter().take(top.max(1)).map(|(id, _)| id).collect())
}

/// 视觉近似去重：基于 CLIP 向量找相似度 >= threshold 的组。返回每组的素材 id（组内按 id 升序，组按大小降序）。
#[tauri::command]
pub fn find_duplicates(
    app: tauri::AppHandle,
    threshold: Option<f32>,
) -> Result<Vec<Vec<i64>>, String> {
    let th = threshold.unwrap_or(0.93);
    let rows = load_clip(&app)?;
    let n = rows.len();

    // 并查集（n 上几千内 O(n²) 可接受；更大规模后续换近邻索引）
    let mut parent: Vec<usize> = (0..n).collect();
    fn find_root(parent: &mut Vec<usize>, mut i: usize) -> usize {
        while parent[i] != i {
            parent[i] = parent[parent[i]];
            i = parent[i];
        }
        i
    }
    for i in 0..n {
        for j in (i + 1)..n {
            if cosine(&rows[i].1, &rows[j].1) >= th {
                let (ri, rj) = (find_root(&mut parent, i), find_root(&mut parent, j));
                if ri != rj {
                    parent[ri] = rj;
                }
            }
        }
    }

    let mut groups: std::collections::HashMap<usize, Vec<i64>> = std::collections::HashMap::new();
    for i in 0..n {
        let r = find_root(&mut parent, i);
        groups.entry(r).or_default().push(rows[i].0);
    }
    let mut out: Vec<Vec<i64>> = groups.into_values().filter(|g| g.len() >= 2).collect();
    for g in out.iter_mut() {
        g.sort();
    }
    out.sort_by(|a, b| b.len().cmp(&a.len()));
    Ok(out)
}
