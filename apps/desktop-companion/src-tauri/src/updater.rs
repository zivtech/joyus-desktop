use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tauri_plugin_updater::UpdaterExt;
use tokio::time::{interval, Duration};

const CHECK_DELAY_SECS: u64 = 30;
const CHECK_INTERVAL_HOURS: u64 = 4;

#[derive(Clone, Serialize)]
pub struct UpdateAvailablePayload {
    pub version: String,
    pub notes: String,
}

/// Perform a single update check. Downloads and verifies the update if available,
/// then emits `update:available` to the frontend.
async fn check_once(app: AppHandle) {
    let updater = match app.updater() {
        Ok(u) => u,
        Err(e) => {
            log::warn!("Updater unavailable: {}", e);
            return;
        }
    };

    let update = match updater.check().await {
        Ok(Some(u)) => u,
        Ok(None) => {
            log::debug!("No update available");
            return;
        }
        Err(e) => {
            log::warn!("Update check failed (offline?): {}", e);
            return;
        }
    };

    let version = update.version.clone();
    let notes = update
        .body
        .clone()
        .unwrap_or_default();

    log::info!("Update available: v{}", version);

    // Download and verify signature. tauri-plugin-updater verifies against the
    // embedded pubkey automatically; an invalid signature causes an error here.
    if let Err(e) = update.download_and_install(|_, _| {}, || {}).await {
        log::error!("Update download/install failed: {}", e);
        return;
    }

    let payload = UpdateAvailablePayload { version, notes };
    if let Err(e) = app.emit("update:available", payload) {
        log::error!("Failed to emit update:available: {}", e);
    }
}

/// Start the background update checker. Called once from `main.rs` during setup.
pub fn start_update_checker(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        // Wait before first check so startup is not delayed.
        tokio::time::sleep(Duration::from_secs(CHECK_DELAY_SECS)).await;
        check_once(app.clone()).await;

        let mut ticker = interval(Duration::from_secs(CHECK_INTERVAL_HOURS * 3600));
        ticker.tick().await; // consume the immediate first tick
        loop {
            ticker.tick().await;
            check_once(app.clone()).await;
        }
    });
}

/// Tauri command: trigger a manual update check from the Settings UI.
#[tauri::command]
pub async fn check_for_update(app: AppHandle) {
    check_once(app).await;
}

/// Tauri command: apply the downloaded update and restart. The frontend calls
/// this when the user clicks "Restart Now" in the UpdateBanner.
#[tauri::command]
pub async fn install_update(app: AppHandle) -> Result<(), String> {
    let updater = app
        .updater()
        .map_err(|e| format!("Updater unavailable: {}", e))?;

    let update = updater
        .check()
        .await
        .map_err(|e| format!("Update check failed: {}", e))?
        .ok_or_else(|| "No update available".to_string())?;

    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|e| format!("Install failed: {}", e))?;

    app.restart();
}
