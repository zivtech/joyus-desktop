use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::oneshot;

/// Shared state for the sidecar connection, stored in Tauri's managed state.
pub struct SidecarState {
    child: Mutex<Option<Child>>,
    stdin_writer: Mutex<Option<Box<dyn Write + Send>>>,
    pending: Arc<Mutex<HashMap<u64, oneshot::Sender<Value>>>>,
    request_id: AtomicU64,
}

impl SidecarState {
    pub fn new() -> Self {
        Self {
            child: Mutex::new(None),
            stdin_writer: Mutex::new(None),
            pending: Arc::new(Mutex::new(HashMap::new())),
            request_id: AtomicU64::new(1),
        }
    }

    /// Send a JSON-RPC request to the sidecar and await the response.
    pub async fn send_request(&self, method: &str, params: Value) -> Result<Value, String> {
        let id = self.request_id.fetch_add(1, Ordering::Relaxed);

        let request = serde_json::json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params,
        });

        let (tx, rx) = oneshot::channel();

        // Register the pending request
        {
            let mut pending = self.pending.lock().map_err(|e| e.to_string())?;
            pending.insert(id, tx);
        }

        // Write request to sidecar stdin
        {
            let mut writer = self.stdin_writer.lock().map_err(|e| e.to_string())?;
            if let Some(ref mut w) = *writer {
                let line = serde_json::to_string(&request).map_err(|e| e.to_string())?;
                writeln!(w, "{}", line).map_err(|e| e.to_string())?;
                w.flush().map_err(|e| e.to_string())?;
            } else {
                // Clean up pending request
                let mut pending = self.pending.lock().map_err(|e| e.to_string())?;
                pending.remove(&id);
                return Err("Sidecar is not running".to_string());
            }
        }

        // Await response with timeout
        match tokio::time::timeout(Duration::from_secs(30), rx).await {
            Ok(Ok(value)) => {
                if let Some(error) = value.get("error") {
                    Err(error.to_string())
                } else if let Some(result) = value.get("result") {
                    Ok(result.clone())
                } else {
                    Ok(value)
                }
            }
            Ok(Err(_)) => Err("Sidecar response channel closed".to_string()),
            Err(_) => {
                // Clean up timed-out request
                let mut pending = self.pending.lock().map_err(|e| e.to_string())?;
                pending.remove(&id);
                Err("Sidecar request timed out after 30 seconds".to_string())
            }
        }
    }
}

/// Spawn the Node.js sidecar process and start the stdout reader.
pub fn spawn_sidecar(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<SidecarState>();

    // Clean up orphaned processes first
    cleanup_orphans(app);

    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("Failed to get resource dir: {}", e))?;

    let sidecar_script = resource_dir.join("binaries").join("sidecar-main.mjs");
    let node_binary = resource_dir.join("binaries").join("node");

    #[cfg(target_os = "windows")]
    let node_binary = resource_dir.join("binaries").join("node.exe");

    let mut child = Command::new(&node_binary)
        .arg(&sidecar_script)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn sidecar: {}", e))?;

    let pid = child.id();

    // Capture stdin for writing requests
    let stdin = child.stdin.take().ok_or("Failed to capture sidecar stdin")?;
    {
        let mut writer = state.stdin_writer.lock().map_err(|e| e.to_string())?;
        *writer = Some(Box::new(stdin));
    }

    // Start stdout reader in a background thread
    let stdout = child.stdout.take().ok_or("Failed to capture sidecar stdout")?;
    let pending = Arc::clone(&state.pending);
    let app_handle = app.clone();

    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            match line {
                Ok(text) => {
                    if text.trim().is_empty() {
                        continue;
                    }
                    match serde_json::from_str::<Value>(&text) {
                        Ok(msg) => {
                            if let Some(id) = msg.get("id") {
                                // Response — resolve pending request
                                if let Some(id_num) = id.as_u64() {
                                    let mut pending = pending.lock().unwrap();
                                    if let Some(tx) = pending.remove(&id_num) {
                                        let _ = tx.send(msg);
                                    }
                                }
                            } else if let Some(method) = msg.get("method").and_then(|m| m.as_str())
                            {
                                // Notification — emit as Tauri event
                                let event_name = map_notification_to_event(method);
                                let params = msg.get("params").cloned().unwrap_or(Value::Null);
                                let _ = app_handle.emit(&event_name, params);
                            }
                        }
                        Err(e) => {
                            log::warn!("Failed to parse sidecar output: {}", e);
                        }
                    }
                }
                Err(e) => {
                    log::error!("Sidecar stdout read error: {}", e);
                    break;
                }
            }
        }
        log::info!("Sidecar stdout reader exited");
    });

    // Start stderr reader for logging
    let stderr = child.stderr.take().ok_or("Failed to capture sidecar stderr")?;
    std::thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines() {
            match line {
                Ok(text) => log::info!("[sidecar] {}", text),
                Err(_) => break,
            }
        }
    });

    // Store child process
    {
        let mut child_guard = state.child.lock().map_err(|e| e.to_string())?;
        *child_guard = Some(child);
    }

    // Write PID file
    write_pid_file(app, pid);

    log::info!("Sidecar spawned with PID {}", pid);
    Ok(())
}

/// Gracefully shutdown the sidecar: SIGTERM, wait 5s, then SIGKILL.
pub fn shutdown_sidecar(app: &AppHandle) {
    let state = app.state::<SidecarState>();

    // Close stdin to signal the sidecar
    {
        if let Ok(mut writer) = state.stdin_writer.lock() {
            *writer = None;
        }
    }

    // Kill the child process
    if let Ok(mut child_guard) = state.child.lock() {
        if let Some(mut child) = child_guard.take() {
            // Try graceful termination first
            let _ = child.kill();
            match child.wait() {
                Ok(status) => log::info!("Sidecar exited with status: {}", status),
                Err(e) => log::error!("Failed to wait for sidecar: {}", e),
            }
        }
    }

    // Remove PID file
    remove_pid_file(app);

    log::info!("Sidecar shutdown complete");
}

/// Map JSON-RPC notification method names to Tauri event names.
fn map_notification_to_event(method: &str) -> String {
    match method {
        "state.serverChanged" => "state:server-changed".to_string(),
        "state.syncCompleted" => "state:sync-completed".to_string(),
        "state.governanceDecision" => "state:governance-decision".to_string(),
        "state.error" => "state:error".to_string(),
        "usage.record" => "usage:record".to_string(),
        other => format!("sidecar:{}", other),
    }
}

/// Write sidecar PID to a file in the app data directory.
fn write_pid_file(app: &AppHandle, pid: u32) {
    if let Ok(data_dir) = app.path().app_data_dir() {
        let pid_file = data_dir.join("companion-pids.json");
        let content = serde_json::json!({ "sidecar_pid": pid });
        let _ = std::fs::create_dir_all(&data_dir);
        let _ = std::fs::write(&pid_file, serde_json::to_string(&content).unwrap_or_default());
    }
}

/// Remove the PID file on clean shutdown.
fn remove_pid_file(app: &AppHandle) {
    if let Ok(data_dir) = app.path().app_data_dir() {
        let pid_file = data_dir.join("companion-pids.json");
        let _ = std::fs::remove_file(&pid_file);
    }
}

/// Clean up orphaned sidecar processes from a previous crash.
fn cleanup_orphans(app: &AppHandle) {
    if let Ok(data_dir) = app.path().app_data_dir() {
        let pid_file = data_dir.join("companion-pids.json");
        if let Ok(content) = std::fs::read_to_string(&pid_file) {
            if let Ok(data) = serde_json::from_str::<Value>(&content) {
                if let Some(pid) = data.get("sidecar_pid").and_then(|p| p.as_u64()) {
                    // Check if process exists and kill it
                    #[cfg(unix)]
                    {
                        use std::process::Command as Cmd;
                        let _ = Cmd::new("kill").arg(pid.to_string()).output();
                    }
                    #[cfg(windows)]
                    {
                        use std::process::Command as Cmd;
                        let _ = Cmd::new("taskkill")
                            .args(&["/PID", &pid.to_string(), "/F"])
                            .output();
                    }
                    log::info!("Cleaned up orphaned sidecar process: {}", pid);
                }
            }
            let _ = std::fs::remove_file(&pid_file);
        }
    }
}
