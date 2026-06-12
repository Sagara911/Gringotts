//! Translation engine: provider routing, glossary, history, and structured results.
//!
//! Entrypoints such as browser selection, global hotkeys, OCR, MCP, and in-app panels
//! should all call this module instead of owning translation logic themselves.

use rusqlite::params;
use serde::{Deserialize, Serialize};

use crate::db::{now_secs, open_db};
use crate::settings::ai_config;

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslationRequest {
    pub text: String,
    pub source_lang: Option<String>,
    pub target_lang: Option<String>,
    pub mode: Option<String>,
    pub provider: Option<String>,
    pub source_app: Option<String>,
    pub source_url: Option<String>,
    pub asset_id: Option<i64>,
    pub save_history: Option<bool>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GlossaryHit {
    pub source: String,
    pub target: String,
    pub explanation: String,
    pub category: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslationResult {
    pub id: Option<i64>,
    pub source_text: String,
    pub target_text: String,
    pub source_lang: String,
    pub target_lang: String,
    pub mode: String,
    pub provider: String,
    pub used_glossary: Vec<GlossaryHit>,
    pub keywords: Vec<String>,
    pub warning: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GlossaryTerm {
    pub id: i64,
    pub source: String,
    pub target: String,
    pub explanation: String,
    pub category: String,
    pub tags: Vec<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub use_count: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlossaryTermIn {
    pub id: Option<i64>,
    pub source: String,
    pub target: String,
    pub explanation: Option<String>,
    pub category: Option<String>,
    pub tags: Option<Vec<String>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslationHistoryItem {
    pub id: i64,
    pub source_text: String,
    pub target_text: String,
    pub source_lang: String,
    pub target_lang: String,
    pub mode: String,
    pub provider: String,
    pub created_at: i64,
}

struct SeedTerm {
    source: &'static str,
    target: &'static str,
    explanation: &'static str,
    category: &'static str,
}

const BUILTIN_TERMS: &[SeedTerm] = &[
    SeedTerm {
        source: "roughness",
        target: "粗糙度",
        explanation: "PBR 材质里控制高光扩散程度，值越高反射越散、越哑光。",
        category: "材质",
    },
    SeedTerm {
        source: "albedo",
        target: "反照率 / 基础色",
        explanation: "材质不含光照影响的固有颜色，常对应 base color 贴图。",
        category: "材质",
    },
    SeedTerm {
        source: "base color",
        target: "基础色",
        explanation: "PBR 工作流里的颜色贴图，通常不包含阴影和高光。",
        category: "材质",
    },
    SeedTerm {
        source: "normal map",
        target: "法线贴图",
        explanation: "用 RGB 编码表面法线方向，在低模上模拟细节起伏。",
        category: "贴图",
    },
    SeedTerm {
        source: "ambient occlusion",
        target: "环境光遮蔽",
        explanation: "表现缝隙、接触处的间接光遮挡，常简称 AO。",
        category: "贴图",
    },
    SeedTerm {
        source: "subsurface scattering",
        target: "次表面散射",
        explanation: "光进入半透明材质内部后散射再透出，常用于皮肤、玉、蜡。",
        category: "材质",
    },
    SeedTerm {
        source: "retopology",
        target: "重拓扑",
        explanation: "重新整理模型布线，让网格更适合动画、雕刻细化或游戏实时渲染。",
        category: "建模",
    },
    SeedTerm {
        source: "rigging",
        target: "绑定",
        explanation: "为模型建立骨骼、控制器和权重，使其可以被动画驱动。",
        category: "动画",
    },
    SeedTerm {
        source: "bevel",
        target: "倒角",
        explanation: "给硬边增加小圆角或斜面，让边缘更真实地吃光。",
        category: "建模",
    },
    SeedTerm {
        source: "uv unwrapping",
        target: "UV 展开",
        explanation: "把三维模型表面展开到二维坐标，供贴图绘制和采样。",
        category: "贴图",
    },
    SeedTerm {
        source: "metallic",
        target: "金属度",
        explanation: "PBR 材质中控制表面按金属还是非金属方式反射光线。",
        category: "材质",
    },
    SeedTerm {
        source: "specular",
        target: "镜面反射",
        explanation: "控制表面高光和反射相关表现，不同工作流含义略有差异。",
        category: "材质",
    },
];

fn norm(s: &str) -> String {
    s.trim().to_lowercase()
}

fn clean_lang(s: Option<String>, fallback: &str) -> String {
    s.map(|x| x.trim().to_string())
        .filter(|x| !x.is_empty())
        .unwrap_or_else(|| fallback.to_string())
}

fn clean_mode(s: Option<String>) -> String {
    let mode = s.unwrap_or_default();
    match mode.as_str() {
        "art_terms" | "prompt" | "tags" => mode,
        _ => "normal".to_string(),
    }
}

fn is_local_base(base: &str) -> bool {
    let b = base.to_lowercase();
    b.contains("localhost") || b.contains("127.0.0.1") || b.contains("0.0.0.0")
}

fn detect_lang(text: &str) -> String {
    let zh = text
        .chars()
        .filter(|c| ('\u{4e00}'..='\u{9fff}').contains(c))
        .count();
    let ascii_alpha = text.chars().filter(|c| c.is_ascii_alphabetic()).count();
    if zh > 0 && zh >= ascii_alpha / 3 {
        "zh".to_string()
    } else if ascii_alpha > 0 {
        "en".to_string()
    } else {
        "auto".to_string()
    }
}

fn prompt_for(
    mode: &str,
    source_lang: &str,
    target_lang: &str,
    text: &str,
    hits: &[GlossaryHit],
) -> String {
    let mode_hint = match mode {
        "art_terms" => "重点解释美术、设计、3D、材质、动画、摄影相关术语。输出：翻译 + 术语解释。",
        "prompt" => {
            "把内容翻译成适合 AI 绘图/素材检索的 prompt。保留关键英文术语，并给出可直接复制的版本。"
        }
        "tags" => {
            "翻译并提取 6-12 个短标签。标签应适合素材管理，输出中文为主，必要时保留英文术语。"
        }
        _ => "自然、准确地翻译。遇到专业术语时简短解释，不要过度展开。",
    };
    let glossary = if hits.is_empty() {
        String::new()
    } else {
        let lines = hits
            .iter()
            .map(|h| format!("- {} = {} ({})", h.source, h.target, h.explanation))
            .collect::<Vec<_>>()
            .join("\n");
        format!("\n术语库优先采用：\n{lines}\n")
    };
    format!(
        "你是 Nobi 内置翻译引擎，面向美术素材、设计、3D 和 AI prompt 工作流。\n\
         源语言：{source_lang}\n目标语言：{target_lang}\n模式：{mode}\n要求：{mode_hint}\n\
         {glossary}\n只输出结果正文，不要解释你如何工作。\n\n原文：\n{text}"
    )
}

fn db_terms(app: &tauri::AppHandle) -> Result<Vec<GlossaryTerm>, String> {
    let conn = open_db(app)?;
    let mut stmt = conn
        .prepare(
            "SELECT id,source,target,COALESCE(explanation,''),COALESCE(category,''),\
             COALESCE(tags,'[]'),COALESCE(created_at,0),COALESCE(updated_at,0),COALESCE(use_count,0)
             FROM glossary_terms ORDER BY length(source) DESC, updated_at DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            let tags_json: String = r.get(5)?;
            Ok(GlossaryTerm {
                id: r.get(0)?,
                source: r.get(1)?,
                target: r.get(2)?,
                explanation: r.get(3)?,
                category: r.get(4)?,
                tags: serde_json::from_str(&tags_json).unwrap_or_default(),
                created_at: r.get(6)?,
                updated_at: r.get(7)?,
                use_count: r.get(8)?,
            })
        })
        .map_err(|e| e.to_string())?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

fn glossary_hits(text: &str, terms: &[GlossaryTerm]) -> Vec<GlossaryHit> {
    let low = norm(text);
    let mut hits = Vec::new();
    for t in terms {
        let s = norm(&t.source);
        if s.is_empty() || !low.contains(&s) {
            continue;
        }
        if hits
            .iter()
            .any(|h: &GlossaryHit| h.source.eq_ignore_ascii_case(&t.source))
        {
            continue;
        }
        hits.push(GlossaryHit {
            source: t.source.clone(),
            target: t.target.clone(),
            explanation: t.explanation.clone(),
            category: t.category.clone(),
        });
        if hits.len() >= 16 {
            break;
        }
    }
    hits
}

fn builtin_terms_as_glossary() -> Vec<GlossaryTerm> {
    BUILTIN_TERMS
        .iter()
        .enumerate()
        .map(|(i, t)| GlossaryTerm {
            id: -((i as i64) + 1),
            source: t.source.to_string(),
            target: t.target.to_string(),
            explanation: t.explanation.to_string(),
            category: t.category.to_string(),
            tags: Vec::new(),
            created_at: 0,
            updated_at: 0,
            use_count: 0,
        })
        .collect()
}

fn merged_terms(app: &tauri::AppHandle) -> Result<Vec<GlossaryTerm>, String> {
    let mut terms = db_terms(app)?;
    terms.extend(builtin_terms_as_glossary());
    terms.sort_by_key(|t| -(t.source.chars().count() as isize));
    Ok(terms)
}

fn keywords_from(text: &str, hits: &[GlossaryHit]) -> Vec<String> {
    let mut out: Vec<String> = hits.iter().map(|h| h.target.clone()).collect();
    for word in text
        .split(|c: char| !c.is_ascii_alphanumeric() && c != '-' && c != '_')
        .map(|w| w.trim())
        .filter(|w| w.chars().count() >= 4)
    {
        if out.len() >= 12 {
            break;
        }
        if !out.iter().any(|x| x.eq_ignore_ascii_case(word)) {
            out.push(word.to_string());
        }
    }
    out
}

fn builtin_translate(
    req: &TranslationRequest,
    source_lang: &str,
    target_lang: &str,
    mode: &str,
    hits: &[GlossaryHit],
) -> String {
    if hits.is_empty() {
        return format!(
            "离线内置模式暂未找到可匹配的术语。\n\n原文：{}\n\n提示：启动本地 Ollama 或配置云端 API 后，可获得完整翻译；术语库仍会优先参与。",
            req.text.trim()
        );
    }
    let mut lines = Vec::new();
    match mode {
        "prompt" => lines.push("Prompt / 素材检索关键词参考：".to_string()),
        "tags" => lines.push("可用标签参考：".to_string()),
        "art_terms" => lines.push("美术术语解释：".to_string()),
        _ => lines.push(format!(
            "离线术语翻译参考（{} -> {}）：",
            source_lang, target_lang
        )),
    }
    for h in hits {
        if mode == "tags" {
            lines.push(format!("{}、{}", h.target, h.source));
        } else {
            lines.push(format!("{} = {}：{}", h.source, h.target, h.explanation));
        }
    }
    lines.push(String::new());
    lines.push("说明：这是无网络/无模型时的内置术语兜底，不会伪装成完整机器翻译。".to_string());
    lines.join("\n")
}

async fn provider_translate(
    app: &tauri::AppHandle,
    req: &TranslationRequest,
    source_lang: &str,
    target_lang: &str,
    mode: &str,
    hits: &[GlossaryHit],
) -> Result<(String, String), String> {
    let (base, model, key) = ai_config(app);
    let provider = if is_local_base(&base) {
        "local-openai"
    } else {
        "remote-openai"
    };
    let url = format!("{}/chat/completions", base.trim_end_matches('/'));
    let prompt = prompt_for(mode, source_lang, target_lang, req.text.trim(), hits);
    let body = serde_json::json!({
        "model": model,
        "stream": false,
        "messages": [
            { "role": "system", "content": "You are a precise translation engine embedded in Nobi." },
            { "role": "user", "content": prompt }
        ]
    });
    let client = reqwest::Client::new();
    let resp = client
        .post(url)
        .timeout(std::time::Duration::from_secs(45))
        .header("Authorization", format!("Bearer {}", key))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("翻译 Provider 请求失败：{e}"))?;
    if !resp.status().is_success() {
        let st = resp.status();
        let t = resp.text().await.unwrap_or_default();
        return Err(format!("翻译 Provider 返回 {st}: {t}"));
    }
    let v: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    let content = v["choices"][0]["message"]["content"]
        .as_str()
        .unwrap_or("")
        .trim()
        .to_string();
    if content.is_empty() {
        return Err("翻译 Provider 返回空结果".to_string());
    }
    Ok((content, provider.to_string()))
}

fn save_history(
    app: &tauri::AppHandle,
    req: &TranslationRequest,
    result: &TranslationResult,
) -> Result<i64, String> {
    let conn = open_db(app)?;
    let keywords = serde_json::to_string(&result.keywords).unwrap_or_else(|_| "[]".to_string());
    let terms = serde_json::to_string(&result.used_glossary).unwrap_or_else(|_| "[]".to_string());
    let summary = result
        .target_text
        .lines()
        .next()
        .unwrap_or("")
        .chars()
        .take(120)
        .collect::<String>();
    conn.execute(
        "INSERT INTO translation_history
         (source_text,target_text,source_lang,target_lang,mode,provider,summary,keywords,terms,source_app,source_url,asset_id,created_at)
         VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)",
        params![
            &result.source_text,
            &result.target_text,
            &result.source_lang,
            &result.target_lang,
            &result.mode,
            &result.provider,
            summary,
            keywords,
            terms,
            req.source_app.as_deref().unwrap_or(""),
            req.source_url.as_deref().unwrap_or(""),
            req.asset_id,
            now_secs()
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(conn.last_insert_rowid())
}

fn bump_terms(app: &tauri::AppHandle, hits: &[GlossaryHit]) {
    if hits.is_empty() {
        return;
    }
    if let Ok(conn) = open_db(app) {
        for h in hits {
            let _ = conn.execute(
                "UPDATE glossary_terms SET use_count=COALESCE(use_count,0)+1, updated_at=?1 WHERE source=?2",
                params![now_secs(), h.source],
            );
        }
    }
}

#[tauri::command]
pub async fn translate_text(
    app: tauri::AppHandle,
    req: TranslationRequest,
) -> Result<TranslationResult, String> {
    let text = req.text.trim();
    if text.is_empty() {
        return Err("翻译文本不能为空".to_string());
    }
    if text.chars().count() > 12_000 {
        return Err("文本太长，请先缩短到 12000 字以内".to_string());
    }

    let source_lang = clean_lang(req.source_lang.clone(), &detect_lang(text));
    let target_lang = clean_lang(req.target_lang.clone(), "zh-CN");
    let mode = clean_mode(req.mode.clone());
    let terms = merged_terms(&app)?;
    let hits = glossary_hits(text, &terms);
    let provider_choice = req
        .provider
        .clone()
        .unwrap_or_else(|| "auto".to_string())
        .to_lowercase();

    let (target_text, provider, warning) = if provider_choice == "builtin" {
        (
            builtin_translate(&req, &source_lang, &target_lang, &mode, &hits),
            "builtin".to_string(),
            None,
        )
    } else {
        match provider_translate(&app, &req, &source_lang, &target_lang, &mode, &hits).await {
            Ok((text, provider)) => (text, provider, None),
            Err(e) if provider_choice == "auto" => (
                builtin_translate(&req, &source_lang, &target_lang, &mode, &hits),
                "builtin-fallback".to_string(),
                Some(e),
            ),
            Err(e) => return Err(e),
        }
    };

    let mut result = TranslationResult {
        id: None,
        source_text: text.to_string(),
        target_text,
        source_lang,
        target_lang,
        mode,
        provider,
        used_glossary: hits,
        keywords: Vec::new(),
        warning,
    };
    result.keywords = keywords_from(text, &result.used_glossary);
    if req.save_history.unwrap_or(true) {
        result.id = Some(save_history(&app, &req, &result)?);
        bump_terms(&app, &result.used_glossary);
    }
    Ok(result)
}

#[tauri::command]
pub fn list_glossary_terms(app: tauri::AppHandle) -> Result<Vec<GlossaryTerm>, String> {
    db_terms(&app)
}

#[tauri::command]
pub fn save_glossary_term(app: tauri::AppHandle, term: GlossaryTermIn) -> Result<i64, String> {
    let source = term.source.trim();
    let target = term.target.trim();
    if source.is_empty() || target.is_empty() {
        return Err("术语原文和译文不能为空".to_string());
    }
    let explanation = term.explanation.unwrap_or_default();
    let category = term.category.unwrap_or_default();
    let tags =
        serde_json::to_string(&term.tags.unwrap_or_default()).unwrap_or_else(|_| "[]".into());
    let now = now_secs();
    let conn = open_db(&app)?;
    if let Some(id) = term.id {
        conn.execute(
            "UPDATE glossary_terms
             SET source=?1,target=?2,explanation=?3,category=?4,tags=?5,updated_at=?6
             WHERE id=?7",
            params![
                source,
                target,
                explanation.trim(),
                category.trim(),
                tags,
                now,
                id
            ],
        )
        .map_err(|e| e.to_string())?;
        Ok(id)
    } else {
        conn.execute(
            "INSERT INTO glossary_terms(source,target,explanation,category,tags,created_at,updated_at,use_count)
             VALUES(?1,?2,?3,?4,?5,?6,?6,0)
             ON CONFLICT(source,target) DO UPDATE SET
               explanation=excluded.explanation,
               category=excluded.category,
               tags=excluded.tags,
               updated_at=excluded.updated_at",
            params![source, target, explanation.trim(), category.trim(), tags, now],
        )
        .map_err(|e| e.to_string())?;
        Ok(conn.last_insert_rowid())
    }
}

#[tauri::command]
pub fn delete_glossary_term(app: tauri::AppHandle, id: i64) -> Result<(), String> {
    let conn = open_db(&app)?;
    conn.execute("DELETE FROM glossary_terms WHERE id=?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn list_translation_history(
    app: tauri::AppHandle,
    limit: Option<i64>,
) -> Result<Vec<TranslationHistoryItem>, String> {
    let limit = limit.unwrap_or(30).clamp(1, 200);
    let conn = open_db(&app)?;
    let mut stmt = conn
        .prepare(
            "SELECT id,source_text,target_text,COALESCE(source_lang,''),COALESCE(target_lang,''),\
             COALESCE(mode,''),COALESCE(provider,''),COALESCE(created_at,0)
             FROM translation_history ORDER BY id DESC LIMIT ?1",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![limit], |r| {
            Ok(TranslationHistoryItem {
                id: r.get(0)?,
                source_text: r.get(1)?,
                target_text: r.get(2)?,
                source_lang: r.get(3)?,
                target_lang: r.get(4)?,
                mode: r.get(5)?,
                provider: r.get(6)?,
                created_at: r.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_basic_languages() {
        assert_eq!(detect_lang("roughness map"), "en");
        assert_eq!(detect_lang("粗糙度贴图"), "zh");
    }

    #[test]
    fn builtin_glossary_hits_art_terms() {
        let terms = builtin_terms_as_glossary();
        let hits = glossary_hits("roughness and normal map", &terms);
        assert!(hits.iter().any(|h| h.target == "粗糙度"));
        assert!(hits.iter().any(|h| h.target == "法线贴图"));
    }

    #[test]
    fn builtin_translate_is_explicit_fallback() {
        let req = TranslationRequest {
            text: "roughness".to_string(),
            source_lang: None,
            target_lang: Some("zh-CN".to_string()),
            mode: Some("art_terms".to_string()),
            provider: Some("builtin".to_string()),
            source_app: None,
            source_url: None,
            asset_id: None,
            save_history: Some(false),
        };
        let terms = builtin_terms_as_glossary();
        let hits = glossary_hits(&req.text, &terms);
        let out = builtin_translate(&req, "en", "zh-CN", "art_terms", &hits);
        assert!(out.contains("粗糙度"));
        assert!(out.contains("内置术语兜底"));
    }
}
