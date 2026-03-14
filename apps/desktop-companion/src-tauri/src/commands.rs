use serde_json::Value;
use tauri::{command, State};

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
pub async fn toggle_autostart(enabled: bool) -> Result<(), String> {
    log::info!("Autostart toggled: {}", enabled);
    Ok(())
}
