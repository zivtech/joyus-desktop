use keyring::Entry;
use std::fs;
use std::path::Path;

const SERVICE: &str = "com.joyus.desktop-companion";

pub const ALLOWED_KEYS: &[&str] = &[
    "ANTHROPIC_API_KEY",
    "DATAFORSEO_USERNAME",
    "DATAFORSEO_PASSWORD",
    "CRUX_API_KEY",
    "PAGESPEED_API_KEY",
];

fn validate_key(key: &str) -> Result<(), String> {
    if ALLOWED_KEYS.contains(&key) {
        Ok(())
    } else {
        Err(format!("credential key not allowed: {key}"))
    }
}

pub fn store_credential(key: &str, value: &str) -> Result<(), String> {
    validate_key(key)?;
    let entry = Entry::new(SERVICE, key).map_err(|e| e.to_string())?;
    entry.set_password(value).map_err(|e| e.to_string())
}

pub fn retrieve_credential(key: &str) -> Result<Option<String>, String> {
    let entry = Entry::new(SERVICE, key).map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(pw) => Ok(Some(pw)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

pub fn delete_credential(key: &str) -> Result<(), String> {
    let entry = Entry::new(SERVICE, key).map_err(|e| e.to_string())?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()), // idempotent
        Err(e) => Err(e.to_string()),
    }
}

pub fn list_stored_keys() -> Vec<String> {
    ALLOWED_KEYS
        .iter()
        .filter(|key| matches!(retrieve_credential(key), Ok(Some(_))))
        .map(|key| key.to_string())
        .collect()
}

pub fn migrate_from_flat_file(app_data_dir: &Path) {
    let cred_file = app_data_dir.join("credentials.env");

    if !cred_file.exists() {
        return; // No flat file, nothing to migrate
    }

    // Only migrate if keychain is empty
    if !list_stored_keys().is_empty() {
        return; // Keychain already has entries, skip migration
    }

    let contents = match fs::read_to_string(&cred_file) {
        Ok(c) => c,
        Err(e) => {
            log::error!("Failed to read credentials.env for migration: {e}");
            return;
        }
    };

    let mut migrated = Vec::new();
    let mut errors = Vec::new();

    for line in contents.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if let Some((key, value)) = line.split_once('=') {
            let key = key.trim();
            let value = value.trim();
            if ALLOWED_KEYS.contains(&key) {
                match store_credential(key, value) {
                    Ok(()) => migrated.push(key.to_string()),
                    Err(e) => errors.push(format!("{key}: {e}")),
                }
            }
        }
    }

    // Verify all migrated keys are in keychain
    let stored = list_stored_keys();
    let all_verified = migrated.iter().all(|k| stored.contains(k));

    if all_verified && errors.is_empty() {
        if let Err(e) = fs::remove_file(&cred_file) {
            log::error!("Failed to delete credentials.env after migration: {e}");
        } else {
            log::info!(
                "Keychain migration complete: {} credentials migrated, flat file deleted",
                migrated.len()
            );
        }
    } else {
        log::error!(
            "Keychain migration incomplete (migrated: {}, errors: {}). Keeping credentials.env.",
            migrated.len(),
            errors.len()
        );
    }
}

#[tauri::command]
pub fn keychain_store(key: String, value: String) -> Result<(), String> {
    store_credential(&key, &value)
}

#[tauri::command]
pub fn keychain_retrieve(key: String) -> Result<Option<String>, String> {
    retrieve_credential(&key)
}

#[tauri::command]
pub fn keychain_delete(key: String) -> Result<(), String> {
    delete_credential(&key)
}

#[tauri::command]
pub fn keychain_list() -> Vec<String> {
    list_stored_keys()
}
