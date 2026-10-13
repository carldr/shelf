mod album_cover_thumbnail_and_colour;
mod oauth_loopback_callback_server;
mod spotify_app_launcher;
mod spotify_refresh_token_keychain;
mod tray_icon_and_window;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_os::init())
        // On macOS, starting at login installs a Launch Agent plist under ~/Library/LaunchAgents.
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, None))
        .setup(|app| {
            // Accessory apps have no Dock icon and no app menu; the tray icon is the only entry point.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            tray_icon_and_window::install_tray_icon_and_window_behaviour(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            tray_icon_and_window::hide_shelf_window_command,
            tray_icon_and_window::quit_shelf_command,
            spotify_refresh_token_keychain::save_spotify_refresh_token,
            spotify_refresh_token_keychain::load_spotify_refresh_token,
            spotify_refresh_token_keychain::delete_spotify_refresh_token,
            oauth_loopback_callback_server::run_spotify_oauth_loopback_authorization,
            album_cover_thumbnail_and_colour::write_album_cover_thumbnail_and_sample_colour,
            spotify_app_launcher::launch_spotify_app_in_background,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Shelf");
}
