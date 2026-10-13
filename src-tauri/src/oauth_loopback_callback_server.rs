//! Receives the Spotify authorization redirect on http://127.0.0.1:43821/callback.
//!
//! Spotify rejects "localhost" redirect URIs and matches the registered URI exactly,
//! so the port is fixed. The frontend shows the same URI on the first-run screen.

use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::time::{Duration, Instant};

use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

pub const OAUTH_LOOPBACK_CALLBACK_PORT: u16 = 43821;
const OAUTH_LOOPBACK_CALLBACK_PATH: &str = "/callback";

/// The user has this long to log in and approve access in the browser.
const OAUTH_LOOPBACK_CALLBACK_TIMEOUT: Duration = Duration::from_secs(300);

const CALLBACK_PAGE_HTML: &str = "<!doctype html><meta charset=utf-8><title>Shelf</title>\
<body style=\"font:15px -apple-system,sans-serif;background:#16161a;color:#eee;display:grid;place-items:center;height:90vh\">\
<p>Shelf has your Spotify authorization. You can close this tab.</p>";

/// Binds the callback port, opens `spotify_authorize_url` in the browser, and waits for the redirect.
/// Returns the raw query string of the callback (`code=…&state=…` or `error=…&state=…`).
/// The frontend checks `state` and reads `code`.
#[tauri::command]
pub async fn run_spotify_oauth_loopback_authorization(
    app_handle: AppHandle,
    spotify_authorize_url: String,
) -> Result<String, String> {
    // Bind before opening the browser: Spotify redirects at once if the user approved Shelf before.
    let listener = TcpListener::bind(("127.0.0.1", OAUTH_LOOPBACK_CALLBACK_PORT)).map_err(|error| {
        format!("Shelf could not listen on port {OAUTH_LOOPBACK_CALLBACK_PORT}: {error}")
    })?;
    app_handle
        .opener()
        .open_url(&spotify_authorize_url, None::<&str>)
        .map_err(|error| error.to_string())?;

    tauri::async_runtime::spawn_blocking(move || wait_for_callback_query_string(listener))
        .await
        .map_err(|error| error.to_string())?
}

fn wait_for_callback_query_string(listener: TcpListener) -> Result<String, String> {
    listener.set_nonblocking(true).map_err(|error| error.to_string())?;
    let deadline = Instant::now() + OAUTH_LOOPBACK_CALLBACK_TIMEOUT;
    while Instant::now() < deadline {
        match listener.accept() {
            Ok((stream, _)) => {
                if let Some(query_string) = answer_request_and_read_callback_query_string(stream) {
                    return Ok(query_string);
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(100));
            }
            Err(error) => return Err(error.to_string()),
        }
    }
    Err("Timed out waiting for Spotify to redirect back to Shelf.".to_string())
}

/// Answers one HTTP request. Returns the query string if the request was the callback.
/// Other requests, such as the browser asking for /favicon.ico, get a 404.
fn answer_request_and_read_callback_query_string(mut stream: TcpStream) -> Option<String> {
    let _ = stream.set_nonblocking(false);
    let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
    let mut request_line = String::new();
    BufReader::new(&stream).read_line(&mut request_line).ok()?;

    // Request line: "GET /callback?code=…&state=… HTTP/1.1"
    let request_target = request_line.split_whitespace().nth(1).unwrap_or_default();
    let (path, query_string) = request_target.split_once('?').unwrap_or((request_target, ""));

    if path != OAUTH_LOOPBACK_CALLBACK_PATH || query_string.is_empty() {
        let _ = stream.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
        return None;
    }

    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        CALLBACK_PAGE_HTML.len(),
        CALLBACK_PAGE_HTML
    );
    let _ = stream.write_all(response.as_bytes());
    Some(query_string.to_string())
}
