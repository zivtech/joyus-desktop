use serde_json::Value;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager,
};

use crate::sidecar::SidecarState;

/// Set up the system tray icon and context menu.
pub fn setup_tray(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let open_item = MenuItem::with_id(app, "open", "Open Dashboard", true, None::<&str>)?;
    let sync_item = MenuItem::with_id(app, "sync", "Sync Now", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;

    let menu = Menu::with_items(app, &[&open_item, &sync_item, &separator, &quit_item])?;

    let mut builder = TrayIconBuilder::new().menu(&menu).tooltip("Joyus Desktop Companion");

    // Use the default window icon for the tray; real tray icons are added in WP13.
    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon);
    }

    builder
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "sync" => {
                let state = app.state::<SidecarState>();
                // Fire-and-forget sync trigger via sidecar
                let app_handle = app.clone();
                tauri::async_runtime::spawn(async move {
                    let st = app_handle.state::<SidecarState>();
                    let _ = st
                        .send_request("sync.trigger", Value::Object(Default::default()))
                        .await;
                });
                let _ = state; // used above via app_handle
            }
            "quit" => {
                crate::sidecar::shutdown_sidecar(app);
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("main") {
                    if window.is_visible().unwrap_or(false) {
                        let _ = window.hide();
                    } else {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
            }
        })
        .build(app)?;

    Ok(())
}

/// Update the tray tooltip to reflect current system health.
/// Real icon swaps will use platform-specific PNGs from WP13.
pub fn update_tray_status(app: &AppHandle, status: &str) {
    let tooltip = match status {
        "warning" => "Joyus Desktop — Warning: server restarting",
        "error" => "Joyus Desktop — Error: server in error state",
        _ => "Joyus Desktop — All servers running",
    };

    if let Some(tray) = app.tray_by_id("main") {
        let _ = tray.set_tooltip(Some(tooltip));
    }
}

/// Listen for sidecar state events and update tray status accordingly.
pub fn listen_for_status_changes(app: &AppHandle) {
    let app_handle = app.clone();
    app.listen("state:server-changed", move |event| {
        if let Some(payload) = event.payload().as_ref() {
            if let Ok(data) = serde_json::from_str::<Value>(payload) {
                let status = data
                    .get("status")
                    .and_then(|s| s.as_str())
                    .unwrap_or("running");
                let tray_status = match status {
                    "error" => "error",
                    "starting" => "warning",
                    _ => "normal",
                };
                update_tray_status(&app_handle, tray_status);
            }
        }
    });
}
