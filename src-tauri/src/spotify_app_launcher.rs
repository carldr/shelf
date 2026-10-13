//! Starts the Spotify desktop app without bringing it forward, so that it registers as a
//! playback device while Shelf keeps focus and its window stays open.

/// macOS: `open -g` does not activate Spotify, and `-j` launches it hidden.
/// Other platforms return an error, and the frontend opens a spotify: URI instead.
#[tauri::command]
pub fn launch_spotify_app_in_background() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let launch_status = std::process::Command::new("/usr/bin/open")
            .args(["-g", "-j", "-a", "Spotify"])
            .status()
            .map_err(|error| error.to_string())?;
        if launch_status.success() {
            Ok(())
        } else {
            Err(format!("open -a Spotify failed: {launch_status}"))
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err("Background launch is only available on macOS.".to_string())
    }
}
