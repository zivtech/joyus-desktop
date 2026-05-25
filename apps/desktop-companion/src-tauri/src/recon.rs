use std::collections::HashMap;
use std::io::ErrorKind;
use std::process::Stdio;
use std::sync::{Arc, Mutex};

use serde_json::Value;
use tauri::Emitter;
use tokio::io::AsyncBufReadExt;
use tokio::process::Command as TokioCommand;

// ─── State types ─────────────────────────────────────────────────────────────

pub struct ReconProcess {
    pub pid: u32,
    pub launch_time: String,
    pub engagement_id: String,
    pub engagement_dir: String,
}

pub type ReconState = Arc<Mutex<HashMap<String, ReconProcess>>>;

pub fn new_recon_state() -> ReconState {
    Arc::new(Mutex::new(HashMap::new()))
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/// Read `~/Library/Application Support/com.joyus.desktop-companion/credentials.env`
/// and parse `KEY=value` lines (comments and blanks are ignored).
fn read_credentials() -> HashMap<String, String> {
    let mut creds: HashMap<String, String> = HashMap::new();

    let cred_path = {
        let Some(home) = dirs::home_dir() else {
            return creds;
        };
        home.join("Library")
            .join("Application Support")
            .join("com.joyus.desktop-companion")
            .join("credentials.env")
    };

    let content = match std::fs::read_to_string(&cred_path) {
        Ok(c) => c,
        Err(_) => return creds, // absent → proceed with empty map
    };

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        if let Some((key, value)) = trimmed.split_once('=') {
            creds.insert(key.trim().to_string(), value.trim().to_string());
        }
    }

    creds
}

/// Check whether a process is still running by sending signal 0 via `kill -0`.
fn process_alive(pid: u32) -> bool {
    std::process::Command::new("kill")
        .args(["-0", &pid.to_string()])
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

// ─── Commands ─────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn launch_recon(
    client_name: String,
    engagement_dir: String,
    max_budget: Option<u32>,
    engagement_id: String,
    state: tauri::State<'_, ReconState>,
    app_handle: tauri::AppHandle,
) -> Result<Value, String> {
    let budget = max_budget.unwrap_or(25);
    let keychain_keys = crate::keychain::list_stored_keys();
    let use_keychain = !keychain_keys.is_empty();

    let launch_time = {
        let d = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default();
        format!("{}Z", d.as_secs())
    };

    let prompt_arg = format!("/joyus-recon --rfp \"{}\"", client_name);
    let budget_str = budget.to_string();

    let mut cmd = TokioCommand::new("claude");
    cmd.args([
        "-p",
        &prompt_arg,
        "--permission-mode",
        "dontAsk",
        "--output-format",
        "stream-json",
        "--max-budget-usd",
        &budget_str,
    ]);
    cmd.current_dir(&engagement_dir);
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::inherit());

    if use_keychain {
        log::info!("launching recon with keychain credentials");
        for key in crate::keychain::ALLOWED_KEYS {
            if let Ok(Some(val)) = crate::keychain::retrieve_credential(key) {
                cmd.env(key, val);
            }
        }
    } else {
        log::info!("launching recon with flat-file credentials (migration pending)");
        let credentials = read_credentials();
        for (key, value) in &credentials {
            cmd.env(key, value);
        }
    }

    let mut child = cmd.spawn().map_err(|e| {
        if e.kind() == ErrorKind::NotFound {
            "claude CLI not found on PATH".to_string()
        } else {
            format!("Failed to spawn claude: {}", e)
        }
    })?;

    let pid = child.id().ok_or("Failed to get child PID")?;

    // Take stdout before moving child into the detached task.
    let stdout = child
        .stdout
        .take()
        .ok_or("Failed to capture claude stdout")?;

    // Detached task: read streaming JSON lines and emit events.
    let engagement_id_clone = engagement_id.clone();
    let app_handle_clone = app_handle.clone();
    tokio::spawn(async move {
        // Keep child alive in this task so it isn't dropped prematurely.
        let _child = child;

        let reader = tokio::io::BufReader::new(stdout);
        let mut lines = reader.lines();

        loop {
            match lines.next_line().await {
                Ok(Some(line)) => {
                    if line.trim().is_empty() {
                        continue;
                    }
                    if let Ok(payload) = serde_json::from_str::<Value>(&line) {
                        let _ = app_handle_clone.emit("recon:progress", &payload);
                    }
                }
                Ok(None) => break, // EOF
                Err(e) => {
                    log::warn!("recon stdout read error: {}", e);
                    break;
                }
            }
        }

        let _ = app_handle_clone.emit(
            "recon:stream-end",
            serde_json::json!({ "engagementId": engagement_id_clone }),
        );
    });

    // Store process metadata. Lock, mutate, drop guard before any await.
    {
        let mut map = state
            .lock()
            .map_err(|e| format!("State lock poisoned: {}", e))?;
        map.insert(
            engagement_id.clone(),
            ReconProcess {
                pid,
                launch_time: launch_time.clone(),
                engagement_id: engagement_id.clone(),
                engagement_dir,
            },
        );
    }

    Ok(serde_json::json!({
        "pid": pid,
        "launchTime": launch_time,
        "engagementId": engagement_id,
    }))
}

#[tauri::command]
pub async fn get_engagement_status(
    engagement_id: String,
    state: tauri::State<'_, ReconState>,
) -> Result<Value, String> {
    // Extract what we need under the lock, then release immediately.
    let entry = {
        let map = state
            .lock()
            .map_err(|e| format!("State lock poisoned: {}", e))?;
        map.get(&engagement_id).map(|p| (p.pid, p.engagement_dir.clone()))
    };

    let Some((pid, engagement_dir)) = entry else {
        return Ok(serde_json::json!({ "status": "unknown" }));
    };

    if process_alive(pid) {
        return Ok(serde_json::json!({ "status": "running", "pid": pid }));
    }

    // Process has exited — remove from state.
    {
        let mut map = state
            .lock()
            .map_err(|e| format!("State lock poisoned: {}", e))?;
        map.remove(&engagement_id);
    }

    // Read sentinel file.
    let sentinel_path = std::path::Path::new(&engagement_dir).join(".recon-complete");
    match std::fs::read_to_string(&sentinel_path) {
        Ok(content) => match serde_json::from_str::<Value>(&content) {
            Ok(meta) => {
                let status = meta
                    .get("status")
                    .and_then(|v| v.as_str())
                    .unwrap_or("complete")
                    .to_string();
                let completed_at = meta.get("timestamp").cloned().unwrap_or(Value::Null);
                let phases_completed =
                    meta.get("phases_completed").cloned().unwrap_or(Value::Null);
                let output_files = meta.get("output_files").cloned().unwrap_or(Value::Null);
                let error = meta.get("error").cloned().unwrap_or(Value::Null);
                // WP10: surface the skill version recorded in the sentinel
                // (snake_case in the sentinel written by the skill, camelCase
                // in this response to match the existing output shape)
                let skill_version = meta.get("skill_version").cloned().unwrap_or(Value::Null);

                Ok(serde_json::json!({
                    "status": status,
                    "completedAt": completed_at,
                    "phasesCompleted": phases_completed,
                    "outputFiles": output_files,
                    "error": error,
                    "skillVersion": skill_version,
                }))
            }
            Err(_) => Ok(serde_json::json!({
                "status": "complete",
                "skillVersion": null,
                "note": "sentinel present but not valid JSON",
            })),
        },
        Err(_) => Ok(serde_json::json!({
            "status": "complete",
            "skillVersion": null,
            "note": "no metadata — sentinel not written",
        })),
    }
}

#[tauri::command]
pub async fn cancel_engagement(
    engagement_id: String,
    state: tauri::State<'_, ReconState>,
) -> Result<Value, String> {
    let pid = {
        let map = state
            .lock()
            .map_err(|e| format!("State lock poisoned: {}", e))?;
        match map.get(&engagement_id) {
            Some(p) => p.pid,
            None => return Err("engagement not found".to_string()),
        }
    };

    // Send SIGTERM (signal 15); ignore errors — process may already be gone.
    let _ = std::process::Command::new("kill")
        .args(["-15", &pid.to_string()])
        .status();

    // Remove from state.
    {
        let mut map = state
            .lock()
            .map_err(|e| format!("State lock poisoned: {}", e))?;
        map.remove(&engagement_id);
    }

    Ok(serde_json::json!({
        "cancelled": true,
        "engagementId": engagement_id,
    }))
}
