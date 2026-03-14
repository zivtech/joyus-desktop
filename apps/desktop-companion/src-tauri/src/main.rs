#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use joyus_desktop_companion::commands;
use joyus_desktop_companion::sidecar::{self, SidecarState};
use joyus_desktop_companion::updater;
use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(
                    "sqlite:companion.db",
                    vec![tauri_plugin_sql::Migration {
                        version: 1,
                        description: "Initial schema",
                        sql: include_str!("../migrations/001_initial_schema.sql"),
                        kind: tauri_plugin_sql::MigrationKind::Up,
                    }],
                )
                .build(),
        )
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
                let _ = window.show();
            }
        }))
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(SidecarState::new())
        .setup(|app| {
            // Spawn the Node.js sidecar on startup
            if let Err(e) = sidecar::spawn_sidecar(app.handle()) {
                log::error!("Failed to spawn sidecar: {}", e);
            }
            // Start background update checker (30s delay, then every 4 hours)
            updater::start_update_checker(app.handle().clone());
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                sidecar::shutdown_sidecar(window.app_handle());
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_servers,
            commands::start_server,
            commands::stop_server,
            commands::restart_server,
            commands::trigger_sync,
            commands::get_sync_status,
            commands::get_skills,
            commands::get_governance_mode,
            commands::get_governance_decisions,
            commands::get_usage_summary,
            commands::query_usage,
            commands::health_check,
            commands::detect_chrome,
            commands::start_onboarding,
            commands::get_config,
            commands::set_config,
            commands::toggle_autostart,
            updater::check_for_update,
            updater::install_update,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
