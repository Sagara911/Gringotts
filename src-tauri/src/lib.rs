//! Nobi 后端入口：只做模块声明与命令注册。
//!
//! 模块分层（详见 docs/ARCHITECTURE.md）：
//! - db        数据层（连接/迁移/公共查询）—— 表结构变更只能发生在这里
//! - library   素材库管理（导入/标签/收藏/导出）
//! - thumbs    缩略图与主色调
//! - ai        视觉 AI（打标/提示词/分析/自定义指令/Ollama 管理）
//! - search    检索（CLIP 存取与相似度 / 文本嵌入备用链路）
//! - settings  Provider 配置（用户设置 > 环境变量 > 默认值）
//! - collections 合集（手攒的具名素材集合；画板可存回库）
//! - collect   浏览器采集（本地 HTTP 服务 + 扩展导出）

mod ai;
mod board;
mod collect;
mod collections;
mod db;
mod library;
mod mcp_api;
mod search;
mod settings;
mod thumbs;

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::Manager;

/// 显示并聚焦主窗（从托盘/还原时统一走这里：可能处于隐藏或最小化）
fn show_main(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

/// 看球小窗老板键：按一下把所有 web-* 窗藏起来，再按一下全部恢复。
/// 任一窗当前可见即视为「显示中」→ 全藏；否则 → 全显。
#[cfg(desktop)]
fn toggle_web_windows(app: &tauri::AppHandle) {
    let wins: Vec<_> = app
        .webview_windows()
        .into_iter()
        .filter(|(label, _)| label.starts_with("web-"))
        .map(|(_, w)| w)
        .collect();
    if wins.is_empty() {
        return;
    }
    let any_visible = wins.iter().any(|w| w.is_visible().unwrap_or(false));
    for w in wins {
        let _ = if any_visible { w.hide() } else { w.show() };
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            collect::start_collect_server(app.handle().clone());

            // 看球小窗老板键：全局快捷键 Alt+`（两键、单手、Windows 上基本无冲突）。
            // Rust 侧注册——不经 IPC，故无需 capabilities 授权；按下切所有 web-* 窗显隐。
            #[cfg(desktop)]
            {
                use tauri_plugin_global_shortcut::{
                    Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState,
                };
                let boss = Shortcut::new(Some(Modifiers::ALT), Code::Backquote);
                app.handle().plugin(
                    tauri_plugin_global_shortcut::Builder::new()
                        .with_handler(move |app, shortcut, event| {
                            if shortcut == &boss && event.state() == ShortcutState::Pressed {
                                toggle_web_windows(app);
                            }
                        })
                        .build(),
                )?;
                // 注册失败（如该键已被他程序占用）不致整个 app 起不来，只是老板键不生效
                let _ = app.global_shortcut().register(boss);
            }

            // 系统托盘：关窗收进托盘（后台采集/MCP 服务不中断），点图标还原
            let show = MenuItem::with_id(app, "show", "显示 Nobi", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;
            TrayIconBuilder::with_id("main")
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Nobi")
                .menu(&menu)
                .show_menu_on_left_click(false) // 左键还原，右键才出菜单
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => show_main(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main(tray.app_handle());
                    }
                })
                .build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            // 点窗口关闭按钮 = 收进托盘而非退出（真正退出走托盘菜单「退出」）
            if window.label() == "main" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    let _ = window.hide();
                    api.prevent_close();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            // library
            library::import_folder,
            library::import_paths,
            library::import_blob,
            library::list_assets,
            library::clear_assets,
            library::remove_asset,
            library::remove_assets,
            library::remove_folder,
            library::set_favorite,
            library::set_tags,
            library::add_tag_bulk,
            library::export_metadata,
            // thumbs
            thumbs::build_thumbnails,
            thumbs::set_thumb,
            // ai
            ai::ai_run,
            ai::ai_tag_bulk,
            ai::ai_run_custom,
            ai::list_ai_commands,
            ai::save_ai_command,
            ai::delete_ai_command,
            ai::ai_status,
            ai::pull_model,
            // search
            search::build_embeddings,
            search::semantic_search,
            search::similar_to,
            search::clip_targets,
            search::set_clip_embedding,
            search::clip_search,
            search::clip_similar,
            search::find_duplicates,
            // settings
            settings::get_settings,
            settings::set_settings,
            // board
            board::list_boards,
            board::create_board,
            board::rename_board,
            board::delete_board,
            board::save_board,
            board::load_board,
            board::save_file,
            // collections
            collections::list_collections,
            collections::create_collection,
            collections::add_to_collection,
            collections::remove_from_collection,
            collections::delete_collection,
            collections::rename_collection,
            collections::collection_asset_ids,
            // collect
            collect::export_extension,
            collect::export_mcp_script
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
