use tauri::command;

/// Placeholder health check command — returns ok.
/// Real commands will be added in WP03-WP06.
#[command]
pub fn health_check() -> String {
    r#"{"ok":true}"#.to_string()
}
