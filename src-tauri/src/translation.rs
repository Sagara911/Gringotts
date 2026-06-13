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

struct OfflineEntry {
    source: &'static str,
    target: &'static str,
}

const OFFLINE_DICTIONARY: &[OfflineEntry] = &[
    OfflineEntry {
        source: "hello",
        target: "你好",
    },
    OfflineEntry {
        source: "hi",
        target: "你好",
    },
    OfflineEntry {
        source: "thanks",
        target: "谢谢",
    },
    OfflineEntry {
        source: "thank",
        target: "谢谢",
    },
    OfflineEntry {
        source: "you",
        target: "你",
    },
    OfflineEntry {
        source: "your",
        target: "你的",
    },
    OfflineEntry {
        source: "i",
        target: "我",
    },
    OfflineEntry {
        source: "my",
        target: "我的",
    },
    OfflineEntry {
        source: "we",
        target: "我们",
    },
    OfflineEntry {
        source: "they",
        target: "他们",
    },
    OfflineEntry {
        source: "he",
        target: "他",
    },
    OfflineEntry {
        source: "she",
        target: "她",
    },
    OfflineEntry {
        source: "it",
        target: "它",
    },
    OfflineEntry {
        source: "this",
        target: "这个",
    },
    OfflineEntry {
        source: "that",
        target: "那个",
    },
    OfflineEntry {
        source: "these",
        target: "这些",
    },
    OfflineEntry {
        source: "those",
        target: "那些",
    },
    OfflineEntry {
        source: "is",
        target: "是",
    },
    OfflineEntry {
        source: "are",
        target: "是",
    },
    OfflineEntry {
        source: "was",
        target: "曾是",
    },
    OfflineEntry {
        source: "were",
        target: "曾是",
    },
    OfflineEntry {
        source: "be",
        target: "是",
    },
    OfflineEntry {
        source: "have",
        target: "有",
    },
    OfflineEntry {
        source: "has",
        target: "有",
    },
    OfflineEntry {
        source: "had",
        target: "有过",
    },
    OfflineEntry {
        source: "do",
        target: "做",
    },
    OfflineEntry {
        source: "does",
        target: "做",
    },
    OfflineEntry {
        source: "did",
        target: "做过",
    },
    OfflineEntry {
        source: "not",
        target: "不",
    },
    OfflineEntry {
        source: "no",
        target: "不",
    },
    OfflineEntry {
        source: "yes",
        target: "是",
    },
    OfflineEntry {
        source: "and",
        target: "和",
    },
    OfflineEntry {
        source: "or",
        target: "或",
    },
    OfflineEntry {
        source: "but",
        target: "但是",
    },
    OfflineEntry {
        source: "because",
        target: "因为",
    },
    OfflineEntry {
        source: "so",
        target: "所以",
    },
    OfflineEntry {
        source: "if",
        target: "如果",
    },
    OfflineEntry {
        source: "then",
        target: "然后",
    },
    OfflineEntry {
        source: "for",
        target: "为了",
    },
    OfflineEntry {
        source: "from",
        target: "来自",
    },
    OfflineEntry {
        source: "to",
        target: "到",
    },
    OfflineEntry {
        source: "in",
        target: "在",
    },
    OfflineEntry {
        source: "on",
        target: "在",
    },
    OfflineEntry {
        source: "with",
        target: "和",
    },
    OfflineEntry {
        source: "without",
        target: "没有",
    },
    OfflineEntry {
        source: "about",
        target: "关于",
    },
    OfflineEntry {
        source: "can",
        target: "可以",
    },
    OfflineEntry {
        source: "could",
        target: "可以",
    },
    OfflineEntry {
        source: "will",
        target: "将会",
    },
    OfflineEntry {
        source: "would",
        target: "会",
    },
    OfflineEntry {
        source: "should",
        target: "应该",
    },
    OfflineEntry {
        source: "need",
        target: "需要",
    },
    OfflineEntry {
        source: "want",
        target: "想要",
    },
    OfflineEntry {
        source: "make",
        target: "制作",
    },
    OfflineEntry {
        source: "create",
        target: "创建",
    },
    OfflineEntry {
        source: "use",
        target: "使用",
    },
    OfflineEntry {
        source: "work",
        target: "工作",
    },
    OfflineEntry {
        source: "test",
        target: "测试",
    },
    OfflineEntry {
        source: "testing",
        target: "测试",
    },
    OfflineEntry {
        source: "improve",
        target: "改进",
    },
    OfflineEntry {
        source: "improvement",
        target: "改进",
    },
    OfflineEntry {
        source: "start",
        target: "开始",
    },
    OfflineEntry {
        source: "stop",
        target: "停止",
    },
    OfflineEntry {
        source: "open",
        target: "打开",
    },
    OfflineEntry {
        source: "close",
        target: "关闭",
    },
    OfflineEntry {
        source: "save",
        target: "保存",
    },
    OfflineEntry {
        source: "copy",
        target: "复制",
    },
    OfflineEntry {
        source: "select",
        target: "选择",
    },
    OfflineEntry {
        source: "all",
        target: "全部",
    },
    OfflineEntry {
        source: "first",
        target: "首先",
    },
    OfflineEntry {
        source: "last",
        target: "最后",
    },
    OfflineEntry {
        source: "small",
        target: "小的",
    },
    OfflineEntry {
        source: "big",
        target: "大的",
    },
    OfflineEntry {
        source: "new",
        target: "新的",
    },
    OfflineEntry {
        source: "old",
        target: "旧的",
    },
    OfflineEntry {
        source: "good",
        target: "好的",
    },
    OfflineEntry {
        source: "bad",
        target: "坏的",
    },
    OfflineEntry {
        source: "fast",
        target: "快的",
    },
    OfflineEntry {
        source: "slow",
        target: "慢的",
    },
    OfflineEntry {
        source: "right",
        target: "正确的",
    },
    OfflineEntry {
        source: "wrong",
        target: "错误的",
    },
    OfflineEntry {
        source: "problem",
        target: "问题",
    },
    OfflineEntry {
        source: "issue",
        target: "问题",
    },
    OfflineEntry {
        source: "error",
        target: "错误",
    },
    OfflineEntry {
        source: "result",
        target: "结果",
    },
    OfflineEntry {
        source: "text",
        target: "文本",
    },
    OfflineEntry {
        source: "translation",
        target: "翻译",
    },
    OfflineEntry {
        source: "translate",
        target: "翻译",
    },
    OfflineEntry {
        source: "language",
        target: "语言",
    },
    OfflineEntry {
        source: "online",
        target: "在线",
    },
    OfflineEntry {
        source: "offline",
        target: "离线",
    },
    OfflineEntry {
        source: "network",
        target: "网络",
    },
    OfflineEntry {
        source: "page",
        target: "页面",
    },
    OfflineEntry {
        source: "window",
        target: "窗口",
    },
    OfflineEntry {
        source: "button",
        target: "按钮",
    },
    OfflineEntry {
        source: "menu",
        target: "菜单",
    },
    OfflineEntry {
        source: "file",
        target: "文件",
    },
    OfflineEntry {
        source: "image",
        target: "图片",
    },
    OfflineEntry {
        source: "video",
        target: "视频",
    },
    OfflineEntry {
        source: "audio",
        target: "音频",
    },
    OfflineEntry {
        source: "game",
        target: "游戏",
    },
    OfflineEntry {
        source: "development",
        target: "开发",
    },
    OfflineEntry {
        source: "confidence",
        target: "信心",
    },
    OfflineEntry {
        source: "come",
        target: "到来",
    },
    OfflineEntry {
        source: "comes",
        target: "到来",
    },
    OfflineEntry {
        source: "prototype",
        target: "原型",
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
        "prompt" | "tags" => mode,
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
        "prompt" => {
            "Translate into a clear prompt that can be copied directly. Keep necessary proper nouns and do not add extra content."
        }
        "tags" => {
            "Translate and extract 6 to 12 short, general-purpose tags. Keep proper nouns when needed."
        }
        _ => {
            "Translate directly, naturally, and accurately like a common online translation tool. Output only the translation."
        }
    };
    let glossary = if hits.is_empty() {
        String::new()
    } else {
        let lines = hits
            .iter()
            .map(|h| format!("- {} = {} ({})", h.source, h.target, h.explanation))
            .collect::<Vec<_>>()
            .join("\n");
        format!("\nPreferred custom glossary terms:\n{lines}\n")
    };
    format!(
        "You are Nobi's built-in general-purpose translation engine.\n\
         Source language: {source_lang}\nTarget language: {target_lang}\nMode: {mode}\nRequirement: {mode_hint}\n\
         {glossary}\nOutput only the result text. Do not explain your process.\n\nSource text:\n{text}"
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

fn merged_terms(app: &tauri::AppHandle) -> Result<Vec<GlossaryTerm>, String> {
    let mut terms = db_terms(app)?;
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

fn offline_lookup(word: &str) -> Option<&'static str> {
    OFFLINE_DICTIONARY
        .iter()
        .find(|entry| entry.source.eq_ignore_ascii_case(word))
        .map(|entry| entry.target)
}

fn offline_translate_token(raw: &str) -> (String, bool) {
    let start = raw
        .char_indices()
        .find(|(_, ch)| ch.is_ascii_alphanumeric())
        .map(|(i, _)| i)
        .unwrap_or(raw.len());
    let end = raw
        .char_indices()
        .rev()
        .find(|(_, ch)| ch.is_ascii_alphanumeric())
        .map(|(i, ch)| i + ch.len_utf8())
        .unwrap_or(start);
    if start >= end {
        return (raw.to_string(), false);
    }
    let head = &raw[..start];
    let core = &raw[start..end];
    let tail = &raw[end..];
    let key = core.to_ascii_lowercase();
    if let Some(target) = offline_lookup(&key) {
        return (format!("{head}{target}{tail}"), true);
    }
    if key.ends_with('s') {
        let singular = key.trim_end_matches('s');
        if let Some(target) = offline_lookup(singular) {
            return (format!("{head}{target}{tail}"), true);
        }
    }
    (raw.to_string(), false)
}

fn offline_translate(
    req: &TranslationRequest,
    _source_lang: &str,
    target_lang: &str,
    _mode: &str,
    hits: &[GlossaryHit],
) -> String {
    let text = req.text.trim();
    if !target_lang.to_lowercase().starts_with("zh") {
        return format!(
            "Offline translation currently supports basic English to Chinese only.\n\nSource: {text}"
        );
    }

    let mut matched = 0usize;
    let translated = text
        .split_whitespace()
        .map(|token| {
            let (out, ok) = offline_translate_token(token);
            if ok {
                matched += 1;
            }
            out
        })
        .collect::<Vec<_>>()
        .join(" ");

    let mut lines = vec![translated];
    if !hits.is_empty() {
        lines.push(String::new());
        lines.push("自定义词库命中：".to_string());
        for h in hits {
            lines.push(format!("{} = {}", h.source, h.target));
        }
    }
    lines.push(String::new());
    if matched == 0 && hits.is_empty() {
        lines.push("[离线] 未命中通用词典，已保留原文。联网后会自动使用在线翻译。".to_string());
    } else {
        lines.push(
            "[离线基础翻译] 这是本地词典结果，适合断网兜底；完整自然句建议使用在线翻译。"
                .to_string(),
        );
    }
    lines.join("\n")
}

fn online_lang_code(lang: &str) -> String {
    let lang = lang.trim();
    if lang.is_empty() || lang.eq_ignore_ascii_case("auto") {
        "auto".to_string()
    } else if lang.eq_ignore_ascii_case("zh") || lang.eq_ignore_ascii_case("zh-cn") {
        "zh-CN".to_string()
    } else {
        lang.to_string()
    }
}

async fn online_translate(
    req: &TranslationRequest,
    source_lang: &str,
    target_lang: &str,
) -> Result<(String, String, Option<String>), String> {
    let client = reqwest::Client::new();
    let sl = online_lang_code(source_lang);
    let tl = online_lang_code(target_lang);
    let resp = client
        .get("https://translate.googleapis.com/translate_a/single")
        .timeout(std::time::Duration::from_secs(12))
        .query(&[
            ("client", "gtx"),
            ("sl", sl.as_str()),
            ("tl", tl.as_str()),
            ("dt", "t"),
            ("q", req.text.trim()),
        ])
        .send()
        .await
        .map_err(|e| format!("在线翻译请求失败：{e}"))?;
    if !resp.status().is_success() {
        let st = resp.status();
        let t = resp.text().await.unwrap_or_default();
        return Err(format!("在线翻译返回 {st}: {t}"));
    }

    let v: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    let mut out = String::new();
    if let Some(parts) = v.get(0).and_then(|x| x.as_array()) {
        for part in parts {
            if let Some(s) = part.get(0).and_then(|x| x.as_str()) {
                out.push_str(s);
            }
        }
    }
    let out = out.trim().to_string();
    if out.is_empty() {
        return Err("在线翻译返回空结果".to_string());
    }
    let detected = v.get(2).and_then(|x| x.as_str()).map(|x| x.to_string());
    Ok((out, "online-google".to_string(), detected))
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

    let mut source_lang = clean_lang(req.source_lang.clone(), &detect_lang(text));
    let target_lang = clean_lang(req.target_lang.clone(), "zh-CN");
    let mode = clean_mode(req.mode.clone());
    let terms = merged_terms(&app)?;
    let hits = glossary_hits(text, &terms);
    let provider_choice = req
        .provider
        .clone()
        .unwrap_or_else(|| "auto".to_string())
        .to_lowercase();

    let (target_text, provider, warning) = match provider_choice.as_str() {
        "offline" | "builtin" => (
            offline_translate(&req, &source_lang, &target_lang, &mode, &hits),
            "offline".to_string(),
            None,
        ),
        "model" => {
            match provider_translate(&app, &req, &source_lang, &target_lang, &mode, &hits).await {
                Ok((text, provider)) => (text, provider, None),
                Err(e) => return Err(e),
            }
        }
        "online" => match online_translate(&req, &source_lang, &target_lang).await {
            Ok((text, provider, detected)) => {
                if source_lang == "auto" {
                    if let Some(detected) = detected {
                        source_lang = detected;
                    }
                }
                (text, provider, None)
            }
            Err(e) => return Err(e),
        },
        _ => match online_translate(&req, &source_lang, &target_lang).await {
            Ok((text, provider, detected)) => {
                if source_lang == "auto" {
                    if let Some(detected) = detected {
                        source_lang = detected;
                    }
                }
                (text, provider, None)
            }
            Err(e) => (
                offline_translate(&req, &source_lang, &target_lang, &mode, &hits),
                "offline-fallback".to_string(),
                Some(e),
            ),
        },
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
        assert_eq!(detect_lang("hello world"), "en");
        assert_eq!(detect_lang("中文翻译"), "zh");
    }

    #[test]
    fn unsupported_mode_falls_back_to_normal() {
        assert_eq!(clean_mode(Some("unsupported".to_string())), "normal");
        assert_eq!(clean_mode(Some("normal".to_string())), "normal");
    }

    #[test]
    fn offline_translate_uses_general_dictionary() {
        let req = TranslationRequest {
            text: "hello world, testing improvement".to_string(),
            source_lang: None,
            target_lang: Some("zh-CN".to_string()),
            mode: Some("normal".to_string()),
            provider: Some("offline".to_string()),
            source_app: None,
            source_url: None,
            asset_id: None,
            save_history: Some(false),
        };
        let out = offline_translate(&req, "en", "zh-CN", "normal", &[]);
        assert!(out.contains("你好"));
        assert!(out.contains("测试"));
        assert!(out.contains("离线基础翻译"));
    }
}
