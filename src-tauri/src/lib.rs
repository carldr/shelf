mod tray_menu_and_window;

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            // Accessory apps have no Dock icon and no app menu; the tray icon is the only entry point.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            tray_menu_and_window::install_tray_icon_and_window_behaviour(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            tray_menu_and_window::hide_shelf_window_command
        ])
        .run(tauri::generate_context!())
        .expect("error while running Shelf");
}
