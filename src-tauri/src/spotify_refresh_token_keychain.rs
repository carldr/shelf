//! Stores the Spotify refresh token in the platform credential store (the Keychain on macOS).
//! The access token never leaves frontend memory.

const KEYCHAIN_SERVICE: &str = "com.example.shelf";
const KEYCHAIN_ACCOUNT: &str = "spotify_refresh_token";

fn spotify_refresh_token_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn save_spotify_refresh_token(spotify_refresh_token: String) -> Result<(), String> {
    spotify_refresh_token_entry()?
        .set_password(&spotify_refresh_token)
        .map_err(|error| error.to_string())
}

/// Returns `None` when no token is stored, so that the frontend shows the first-run screen.
#[tauri::command]
pub fn load_spotify_refresh_token() -> Result<Option<String>, String> {
    match spotify_refresh_token_entry()?.get_password() {
        Ok(spotify_refresh_token) => Ok(Some(spotify_refresh_token)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
pub fn delete_spotify_refresh_token() -> Result<(), String> {
    match spotify_refresh_token_entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}
