use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{App, AppHandle, Emitter, Manager, PhysicalPosition, Rect, WebviewWindow, WindowEvent};

pub const SHELF_WINDOW_LABEL: &str = "shelf";

/// Gap in physical pixels between the bottom of the menu bar and the top of the window.
const WINDOW_GAP_BELOW_TRAY_ICON: f64 = 6.0;

/// A click on the tray icon first takes focus from the window, which hides it.
/// The click that follows must not show it again, so a hide this recent blocks the toggle.
const BLUR_HIDE_DEBOUNCE: Duration = Duration::from_millis(300);

#[derive(Default)]
struct ShelfWindowBlurHideTime(Mutex<Option<Instant>>);

/// The window opens from 1 pixel high to its full height over this time, easing out.
const SHELF_WINDOW_OPEN_DURATION: Duration = Duration::from_millis(250);
/// The opening resizes the window about this often.
const SHELF_WINDOW_OPEN_STEP_INTERVAL: Duration = Duration::from_millis(8);

/// The window's full height in physical pixels, from tauri.conf.json. The opening grows the window to it.
struct ShelfWindowFullHeight(u32);

/// Counts openings and hidings, so that an opening stops when the window hides or opens again.
#[derive(Default)]
struct ShelfWindowOpenGeneration(AtomicU64);

pub fn install_tray_icon_and_window_behaviour(app: &mut App) -> tauri::Result<()> {
    app.manage(ShelfWindowBlurHideTime::default());
    app.manage(ShelfWindowOpenGeneration::default());

    let shelf_window = shelf_window(app.handle());
    let full_height = shelf_window.outer_size().map(|size| size.height).unwrap_or(1);
    app.manage(ShelfWindowFullHeight(full_height));
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

    // The tray icon has no menu: a left click toggles the window, and Refresh, Settings and
    // Quit are in the window. A right click does nothing.
    let shelf_tray_icon = TrayIconBuilder::with_id("shelf_tray_icon")
        .icon(tauri::include_image!("icons/tray_icon_template.png"))
        .icon_as_template(true)
        .tooltip("Shelf")
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
        .build(app)?;

    // Debug builds only: SHELF_SHOW_WINDOW_ON_LAUNCH=1 shows the window without a click and
    // without taking focus, so that performance runs need no mouse input.
    if cfg!(debug_assertions) && std::env::var("SHELF_SHOW_WINDOW_ON_LAUNCH").as_deref() == Ok("1") {
        if let Ok(Some(tray_icon_rect)) = shelf_tray_icon.rect() {
            anchor_shelf_window_under_tray_icon(&shelf_window, tray_icon_rect, full_height);
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
    let full_height = app_handle.state::<ShelfWindowFullHeight>().0;
    anchor_shelf_window_under_tray_icon(&window, tray_icon_rect, full_height);
    show_shelf_window(app_handle);
}

/// Shows the window 1 pixel high and grows it to its full height. The frontend hears `shelf_window_shown`
/// at the start, so its Spotify poll runs while the window grows.
fn show_shelf_window(app_handle: &AppHandle) {
    let window = shelf_window(app_handle);
    let full_height = app_handle.state::<ShelfWindowFullHeight>().0;
    let (Ok(window_size), Ok(window_position)) = (window.outer_size(), window.outer_position()) else {
        let _ = window.show();
        let _ = window.set_focus();
        let _ = app_handle.emit("shelf_window_shown", ());
        return;
    };
    let window_width = window_size.width;
    let _ = window.set_size(tauri::PhysicalSize::new(window_width, 1));
    let _ = window.set_position(window_position);
    let _ = window.show();
    let _ = window.set_focus();
    let _ = app_handle.emit("shelf_window_shown", ());

    let open_generation = app_handle.state::<ShelfWindowOpenGeneration>().0.fetch_add(1, Ordering::SeqCst) + 1;
    let app_handle = app_handle.clone();
    std::thread::spawn(move || {
        let open_start = Instant::now();
        loop {
            if app_handle.state::<ShelfWindowOpenGeneration>().0.load(Ordering::SeqCst) != open_generation {
                return;
            }
            let progress = (open_start.elapsed().as_secs_f64() / SHELF_WINDOW_OPEN_DURATION.as_secs_f64()).min(1.0);
            let window_height = compute_shelf_window_open_height(progress, full_height);
            // The top edge stays under the menu bar while the bottom edge moves down.
            let _ = window.set_size(tauri::PhysicalSize::new(window_width, window_height));
            let _ = window.set_position(window_position);
            if progress >= 1.0 {
                return;
            }
            std::thread::sleep(SHELF_WINDOW_OPEN_STEP_INTERVAL);
        }
    });
}

/// The window height during the opening: an ease-out cubic from 1 pixel at `progress` 0 to `full_height` at 1.
fn compute_shelf_window_open_height(progress: f64, full_height: u32) -> u32 {
    let eased_progress = 1.0 - (1.0 - progress.clamp(0.0, 1.0)).powi(3);
    ((full_height as f64 * eased_progress).round() as u32).clamp(1, full_height.max(1))
}

/// Quits Shelf from the Quit button in the window.
#[tauri::command]
pub fn quit_shelf_command(app_handle: AppHandle) {
    app_handle.exit(0);
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
    // Stops an opening that is still growing the window.
    app_handle.state::<ShelfWindowOpenGeneration>().0.fetch_add(1, Ordering::SeqCst);
    let _ = window.hide();
    // Deactivating the app gives focus back to the app that had it before the window opened.
    #[cfg(target_os = "macos")]
    let _ = app_handle.hide();
    *app_handle.state::<ShelfWindowBlurHideTime>().0.lock().unwrap() = Some(Instant::now());
    let _ = app_handle.emit("shelf_window_hidden", ());
}

/// Places the window just below the menu bar, spanning the width of the monitor that holds the tray icon.
/// Without a matching monitor, the window keeps its width and is centred under the icon.
fn anchor_shelf_window_under_tray_icon(window: &WebviewWindow, tray_icon_rect: Rect, full_height: u32) {
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

    let _ = window.set_size(tauri::PhysicalSize::new(window_width.round() as u32, full_height));
    let _ = window.set_position(PhysicalPosition::new(window_x.round() as i32, window_y.round() as i32));
}

#[cfg(test)]
mod tests {
    use super::compute_shelf_window_open_height;

    #[test]
    fn shelf_window_open_height_eases_out_from_one_pixel_to_full_height() {
        assert_eq!(compute_shelf_window_open_height(0.0, 640), 1);
        assert_eq!(compute_shelf_window_open_height(1.0, 640), 640);
        // Ease-out: half way through the time, the window is 7/8 of its height.
        assert_eq!(compute_shelf_window_open_height(0.5, 640), 560);
        assert_eq!(compute_shelf_window_open_height(2.0, 640), 640);
    }
}
