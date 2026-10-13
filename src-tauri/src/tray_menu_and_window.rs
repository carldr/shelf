use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{App, AppHandle, Emitter, Manager, PhysicalPosition, Rect, WebviewWindow, WindowEvent};

pub const SHELF_WINDOW_LABEL: &str = "shelf";

const MENU_ITEM_REFRESH_LIBRARY: &str = "refresh_library";
const MENU_ITEM_OPEN_SETTINGS: &str = "open_settings";
const MENU_ITEM_QUIT: &str = "quit";

/// Gap in physical pixels between the bottom of the menu bar and the top of the window.
const WINDOW_GAP_BELOW_TRAY_ICON: f64 = 6.0;

/// A click on the tray icon first takes focus from the window, which hides it.
/// The click that follows must not show it again, so a hide this recent blocks the toggle.
const BLUR_HIDE_DEBOUNCE: Duration = Duration::from_millis(300);

#[derive(Default)]
struct ShelfWindowBlurHideTime(Mutex<Option<Instant>>);

pub fn install_tray_icon_and_window_behaviour(app: &mut App) -> tauri::Result<()> {
    app.manage(ShelfWindowBlurHideTime::default());

    let shelf_window = shelf_window(app.handle());
    let app_handle = app.handle().clone();
    shelf_window.on_window_event(move |window_event| match window_event {
        WindowEvent::Focused(false) => hide_shelf_window(&app_handle),
        WindowEvent::CloseRequested { api, .. } => {
            // Keep the window alive so that reopening is instant.
            api.prevent_close();
            hide_shelf_window(&app_handle);
        }
        _ => {}
    });

    let tray_menu = Menu::with_items(
        app,
        &[
            &MenuItem::with_id(app, MENU_ITEM_REFRESH_LIBRARY, "Refresh library", true, None::<&str>)?,
            &MenuItem::with_id(app, MENU_ITEM_OPEN_SETTINGS, "Settings…", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, MENU_ITEM_QUIT, "Quit Shelf", true, Some("CmdOrCtrl+Q"))?,
        ],
    )?;

    let shelf_tray_icon = TrayIconBuilder::with_id("shelf_tray_icon")
        .icon(tauri::include_image!("icons/tray_icon_template.png"))
        .icon_as_template(true)
        .tooltip("Shelf")
        .menu(&tray_menu)
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray_icon, tray_icon_event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                rect,
                ..
            } = tray_icon_event
            {
                toggle_shelf_window(tray_icon.app_handle(), rect);
            }
        })
        .on_menu_event(|app_handle, menu_event| match menu_event.id().as_ref() {
            MENU_ITEM_REFRESH_LIBRARY => {
                let _ = app_handle.emit("tray_menu_refresh_library", ());
            }
            MENU_ITEM_OPEN_SETTINGS => {
                show_shelf_window(app_handle);
                let _ = app_handle.emit("tray_menu_open_settings", ());
            }
            MENU_ITEM_QUIT => app_handle.exit(0),
            _ => {}
        })
        .build(app)?;

    // Debug builds only: SHELF_SHOW_WINDOW_ON_LAUNCH=1 shows the window without a click and
    // without taking focus, so that performance runs need no mouse input.
    if cfg!(debug_assertions) && std::env::var("SHELF_SHOW_WINDOW_ON_LAUNCH").as_deref() == Ok("1") {
        if let Ok(Some(tray_icon_rect)) = shelf_tray_icon.rect() {
            anchor_shelf_window_under_tray_icon(&shelf_window, tray_icon_rect);
        }
        let _ = shelf_window.show();
    }

    Ok(())
}

fn shelf_window(app_handle: &AppHandle) -> WebviewWindow {
    app_handle
        .get_webview_window(SHELF_WINDOW_LABEL)
        .expect("tauri.conf.json defines the shelf window")
}

fn toggle_shelf_window(app_handle: &AppHandle, tray_icon_rect: Rect) {
    let window = shelf_window(app_handle);
    if window.is_visible().unwrap_or(false) {
        hide_shelf_window(app_handle);
        return;
    }
    let blur_hide_time = app_handle.state::<ShelfWindowBlurHideTime>();
    let hidden_by_this_click = blur_hide_time
        .0
        .lock()
        .unwrap()
        .is_some_and(|hide_time| hide_time.elapsed() < BLUR_HIDE_DEBOUNCE);
    if hidden_by_this_click {
        return;
    }
    anchor_shelf_window_under_tray_icon(&window, tray_icon_rect);
    show_shelf_window(app_handle);
}

fn show_shelf_window(app_handle: &AppHandle) {
    let window = shelf_window(app_handle);
    let _ = window.show();
    let _ = window.set_focus();
    let _ = app_handle.emit("shelf_window_shown", ());
}

/// Lets the frontend hide the window (Esc) through the same path as blur and the tray icon.
#[tauri::command]
pub fn hide_shelf_window_command(app_handle: AppHandle) {
    hide_shelf_window(&app_handle);
}

fn hide_shelf_window(app_handle: &AppHandle) {
    let window = shelf_window(app_handle);
    if !window.is_visible().unwrap_or(false) {
        return;
    }
    let _ = window.hide();
    // Deactivating the app gives focus back to the app that had it before the window opened.
    #[cfg(target_os = "macos")]
    let _ = app_handle.hide();
    *app_handle.state::<ShelfWindowBlurHideTime>().0.lock().unwrap() = Some(Instant::now());
    let _ = app_handle.emit("shelf_window_hidden", ());
}

/// Places the window just below the menu bar, spanning the width of the monitor that holds the tray icon.
/// Without a matching monitor, the window keeps its width and is centred under the icon.
fn anchor_shelf_window_under_tray_icon(window: &WebviewWindow, tray_icon_rect: Rect) {
    let scale_factor = window.scale_factor().unwrap_or(1.0);
    let icon_position: PhysicalPosition<f64> = tray_icon_rect.position.to_physical(scale_factor);
    let icon_size: tauri::PhysicalSize<f64> = tray_icon_rect.size.to_physical(scale_factor);
    let Ok(window_size) = window.outer_size() else { return };
    let margin = WINDOW_GAP_BELOW_TRAY_ICON * scale_factor;
    let window_y = icon_position.y + icon_size.height + margin;

    // monitor_from_point reads its arguments as logical on macOS, so match physical rects directly.
    let monitor_holding_icon = window.available_monitors().unwrap_or_default().into_iter().find(|monitor| {
        let left = monitor.position().x as f64;
        let top = monitor.position().y as f64;
        (left..left + monitor.size().width as f64).contains(&icon_position.x)
            && (top..top + monitor.size().height as f64).contains(&icon_position.y)
    });

    let (window_x, window_width) = match monitor_holding_icon {
        Some(monitor) => (
            monitor.position().x as f64 + margin,
            monitor.size().width as f64 - 2.0 * margin,
        ),
        None => (
            icon_position.x + icon_size.width / 2.0 - window_size.width as f64 / 2.0,
            window_size.width as f64,
        ),
    };

    let _ = window.set_size(tauri::PhysicalSize::new(window_width.round() as u32, window_size.height));
    let _ = window.set_position(PhysicalPosition::new(window_x.round() as i32, window_y.round() as i32));
}
