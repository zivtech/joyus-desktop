use serde_json::Value;
use tauri::{command, AppHandle, State};
use tauri_plugin_autostart::ManagerExt;

use crate::sidecar::SidecarState;

#[command]
pub async fn get_servers(state: State<'_, SidecarState>) -> Result<Value, String> {
    state.send_request("servers.list", Value::Object(Default::default())).await
}

#[command]
pub async fn start_server(state: State<'_, SidecarState>, name: String) -> Result<Value, String> {
    state.send_request("servers.start", serde_json::json!({ "name": name })).await
}

#[command]
pub async fn stop_server(state: State<'_, SidecarState>, name: String) -> Result<Value, String> {
    state.send_request("servers.stop", serde_json::json!({ "name": name })).await
}

#[command]
pub async fn restart_server(state: State<'_, SidecarState>, name: String) -> Result<Value, String> {
    state.send_request("servers.restart", serde_json::json!({ "name": name })).await
}

#[command]
pub async fn trigger_sync(state: State<'_, SidecarState>) -> Result<Value, String> {
    state.send_request("sync.trigger", Value::Object(Default::default())).await
}

#[command]
pub async fn get_sync_status(state: State<'_, SidecarState>) -> Result<Value, String> {
    state.send_request("sync.status", Value::Object(Default::default())).await
}

#[command]
pub async fn get_skills(state: State<'_, SidecarState>) -> Result<Value, String> {
    state.send_request("skills.list", Value::Object(Default::default())).await
}

#[command]
pub async fn get_governance_mode(state: State<'_, SidecarState>) -> Result<Value, String> {
    state.send_request("governance.getMode", Value::Object(Default::default())).await
}

#[command]
pub async fn get_governance_decisions(state: State<'_, SidecarState>, limit: u32) -> Result<Value, String> {
    state.send_request("governance.getDecisions", serde_json::json!({ "limit": limit })).await
}

#[command]
pub async fn get_usage_summary(state: State<'_, SidecarState>, days: u32) -> Result<Value, String> {
    state.send_request("usage.summary", serde_json::json!({ "days": days })).await
}

#[command]
pub async fn query_usage(state: State<'_, SidecarState>, params: Value) -> Result<Value, String> {
    state.send_request("usage.query", params).await
}

#[command]
pub async fn health_check(state: State<'_, SidecarState>) -> Result<Value, String> {
    state.send_request("health.check", Value::Object(Default::default())).await
}

#[command]
pub async fn detect_chrome(state: State<'_, SidecarState>) -> Result<Value, String> {
    state.send_request("chrome.detect", Value::Object(Default::default())).await
}

#[command]
pub async fn start_onboarding(state: State<'_, SidecarState>, params: Value) -> Result<Value, String> {
    state.send_request("onboarding.start", params).await
}

#[command]
pub async fn get_config(state: State<'_, SidecarState>, key: String) -> Result<Value, String> {
    state.send_request("config.get", serde_json::json!({ "key": key })).await
}

#[command]
pub async fn set_config(state: State<'_, SidecarState>, key: String, value: String) -> Result<Value, String> {
    state.send_request("config.set", serde_json::json!({ "key": key, "value": value })).await
}

#[command]
pub async fn toggle_autostart(app: AppHandle, enabled: bool) -> Result<(), String> {
    let autolaunch = app.autolaunch();
    if enabled {
        autolaunch.enable().map_err(|e| format!("Autostart error: {e}"))?;
    } else {
        autolaunch.disable().map_err(|e| format!("Autostart error: {e}"))?;
    }
    log::info!("Autostart toggled: {}", enabled);
    Ok(())
}

#[command]
pub async fn get_autostart_status(app: AppHandle) -> Result<Value, String> {
    let autolaunch = app.autolaunch();
    let enabled = autolaunch
        .is_enabled()
        .map_err(|e| format!("Autostart error: {e}"))?;
    Ok(serde_json::json!({ "enabled": enabled }))
}

// ─── Site commands ───────────────────────────────────────────────────────────

#[command]
pub async fn site_list_local(state: State<'_, SidecarState>) -> Result<Value, String> {
    state.send_request("sites.listLocal", Value::Object(Default::default())).await
}

#[command]
pub async fn site_list_remote(state: State<'_, SidecarState>) -> Result<Value, String> {
    state.send_request("sites.listRemote", Value::Object(Default::default())).await
}

#[command]
pub async fn site_start(state: State<'_, SidecarState>, site_id: String) -> Result<Value, String> {
    state.send_request("sites.start", serde_json::json!({ "siteId": site_id })).await
}

#[command]
pub async fn site_stop(state: State<'_, SidecarState>, site_id: String) -> Result<Value, String> {
    state.send_request("sites.stop", serde_json::json!({ "siteId": site_id })).await
}

#[command]
pub async fn site_restart(state: State<'_, SidecarState>, site_id: String) -> Result<Value, String> {
    state.send_request("sites.restart", serde_json::json!({ "siteId": site_id })).await
}

#[command]
pub async fn site_provision(state: State<'_, SidecarState>, repo_url: String) -> Result<Value, String> {
    state.send_request("sites.provision", serde_json::json!({ "repoUrl": repo_url })).await
}

// ─── Recon proxy commands ────────────────────────────────────────────────────

#[command]
pub async fn create_engagement(state: State<'_, SidecarState>, params: Value) -> Result<Value, String> {
    state.send_request("recon.create", params).await
}

#[command]
pub async fn recon_scan(state: State<'_, SidecarState>, params: Value) -> Result<Value, String> {
    state.send_request("recon.scan", params).await
}

#[command]
pub async fn recon_export(state: State<'_, SidecarState>, params: Value) -> Result<Value, String> {
    state.send_request("recon.export", params).await
}

// ─── Credential proxy commands ───────────────────────────────────────────────

/// Save a single credential key/value pair. Proxies to the sidecar's
/// `credentials.save` handler.
#[command]
pub async fn credentials_save(state: State<'_, SidecarState>, params: Value) -> Result<Value, String> {
    state.send_request("credentials.save", params).await
}

/// List all known credential keys with their isSet status. Proxies to the
/// sidecar's `credentials.list` handler.
#[command]
pub async fn credentials_list(state: State<'_, SidecarState>) -> Result<Value, String> {
    state.send_request("credentials.list", Value::Object(Default::default())).await
}

/// Verify all configured credentials against the upstream services. Proxies to
/// the sidecar's `credentials.verify` handler.
#[command]
pub async fn credentials_verify(state: State<'_, SidecarState>) -> Result<Value, String> {
    state.send_request("credentials.verify", Value::Object(Default::default())).await
}

/// Detect whether Claude Code CLI is installed and accessible on PATH.
#[command]
pub async fn check_claude_binary(state: State<'_, SidecarState>) -> Result<Value, String> {
    state.send_request("claude.detect", Value::Object(Default::default())).await
}

/// Check whether the Recon skill file exists at ~/.claude/skills/joyus-recon.md.
/// Proxies to the sidecar's `skills.checkFile` handler.
#[command]
pub async fn check_skill_file(state: State<'_, SidecarState>) -> Result<Value, String> {
    state.send_request("skills.checkFile", Value::Object(Default::default())).await
}

// ─── GitHub OAuth commands ──────────────────────────────────────────────────

#[command]
pub async fn github_auth_start(state: State<'_, SidecarState>, params: Value) -> Result<Value, String> {
    state.send_request("github-auth.start", params).await
}

#[command]
pub async fn github_auth_cancel(state: State<'_, SidecarState>) -> Result<Value, String> {
    state.send_request("github-auth.cancel", Value::Object(Default::default())).await
}

// ─── Session commands ────────────────────────────────────────────────────────

#[command]
pub async fn session_list_by_repo(state: State<'_, SidecarState>, repo_path: String) -> Result<Value, String> {
    state.send_request("session.listByRepo", serde_json::json!({ "repoPath": repo_path })).await
}

#[command]
pub async fn session_counts_by_repo(state: State<'_, SidecarState>) -> Result<Value, String> {
    state.send_request("session.countsByRepo", Value::Object(Default::default())).await
}

/// Stop all MCP server processes, remove managed .mcp.json entries, and optionally
/// delete app data (skill-sync cache + app data directory).
#[command]
pub async fn reset_desktop_companion(
    state: State<'_, SidecarState>,
    delete_data: bool,
) -> Result<(), String> {
    // Ask the sidecar to stop all servers and clean up .mcp.json entries.
    state
        .send_request("servers.stopAll", serde_json::Value::Object(Default::default()))
        .await
        .ok(); // best-effort — proceed even if sidecar is already down

    if delete_data {
        // Remove the skill-sync cache directory (~/.claude/.skill-sync-cache/).
        if let Some(home) = dirs::home_dir() {
            let cache = home.join(".claude").join(".skill-sync-cache");
            if cache.exists() {
                std::fs::remove_dir_all(&cache)
                    .map_err(|e| format!("Failed to remove skill-sync cache: {e}"))?;
            }
        }

        // Remove Tauri app data directory (config, databases, etc.).
        // tauri::api::path::app_data_dir is not available as a free function in Tauri v2;
        // the path follows platform conventions:
        //   macOS  ~/Library/Application Support/<identifier>
        //   Windows %APPDATA%\<identifier>
        //   Linux   ~/.local/share/<identifier>
        #[cfg(target_os = "macos")]
        {
            if let Some(home) = dirs::home_dir() {
                let app_data = home
                    .join("Library")
                    .join("Application Support")
                    .join("com.joyus.desktop-companion");
                if app_data.exists() {
                    std::fs::remove_dir_all(&app_data)
                        .map_err(|e| format!("Failed to remove app data: {e}"))?;
                }
            }
        }
        #[cfg(target_os = "windows")]
        {
            if let Ok(appdata) = std::env::var("APPDATA") {
                let app_data = std::path::PathBuf::from(appdata).join("com.joyus.desktop-companion");
                if app_data.exists() {
                    std::fs::remove_dir_all(&app_data)
                        .map_err(|e| format!("Failed to remove app data: {e}"))?;
                }
            }
        }
        #[cfg(target_os = "linux")]
        {
            if let Some(home) = dirs::home_dir() {
                let app_data = home
                    .join(".local")
                    .join("share")
                    .join("com.joyus.desktop-companion");
                if app_data.exists() {
                    std::fs::remove_dir_all(&app_data)
                        .map_err(|e| format!("Failed to remove app data: {e}"))?;
                }
            }
        }
    }

    log::info!("reset_desktop_companion complete (delete_data={})", delete_data);
    Ok(())
}
