//! Stores the Spotify refresh token in the platform credential store (the Keychain on macOS).
//! The access token never leaves frontend memory.
//!
//! The Keychain service is the app's bundle identifier, so that a build with its own identifier
//! (set in tauri.local.conf.json) keeps its own login.

use tauri::AppHandle;

const KEYCHAIN_ACCOUNT: &str = "spotify_refresh_token";

fn spotify_refresh_token_entry(app_handle: &AppHandle) -> Result<keyring::Entry, String> {
    keyring::Entry::new(&app_handle.config().identifier, KEYCHAIN_ACCOUNT).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn save_spotify_refresh_token(app_handle: AppHandle, spotify_refresh_token: String) -> Result<(), String> {
    spotify_refresh_token_entry(&app_handle)?
        .set_password(&spotify_refresh_token)
        .map_err(|error| error.to_string())
}

/// Returns `None` when no token is stored, so that the frontend shows the first-run screen.
#[tauri::command]
pub fn load_spotify_refresh_token(app_handle: AppHandle) -> Result<Option<String>, String> {
    match spotify_refresh_token_entry(&app_handle)?.get_password() {
        Ok(spotify_refresh_token) => Ok(Some(spotify_refresh_token)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
pub fn delete_spotify_refresh_token(app_handle: AppHandle) -> Result<(), String> {
    match spotify_refresh_token_entry(&app_handle)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}
