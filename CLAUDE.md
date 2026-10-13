# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Shelf is a Tauri 2 macOS menu bar app. It shows the user's saved Spotify albums as a shelf of CD jewel cases.
`README.md` has the setup, the user-facing behaviour, the data files and the project layout. Read it first.

## Commands

| Command | What it does |
|---|---|
| `pnpm tauri dev` | Runs the app with live reload. The first run compiles every Rust crate. |
| `pnpm tauri build` | Builds `src-tauri/target/release/bundle/macos/Shelf.app`. |
| `pnpm test` | Runs the Vitest tests in `src/**/*.test.ts`. |
| `pnpm vitest run src/shelf/shelf_layout.test.ts` | Runs one TypeScript test file. Add `-t "<name>"` for one test. |
| `pnpm typecheck` | Runs `tsc --noEmit`. `pnpm build` runs it too. |
| `cargo test` (in `src-tauri`) | Runs the Rust tests. Add a test name to run one. |
| `VITE_SHELF_STRESS_TEST_ALBUM_COUNT=1200 pnpm tauri dev` | Repeats the library to 1,200 albums and shows frame times. Dev builds only. |

Use `pnpm tauri`, not `tauri` directly. `scripts/run_tauri_with_local_config.mjs` merges `src-tauri/tauri.local.conf.json` over `tauri.conf.json` for `dev` and `build`.
The local file holds the bundle identifier and is ignored by git. The committed identifier is `com.example.shelf`.

## Architecture

The TypeScript frontend in `src/` holds almost all the logic: Spotify auth, Web API calls, library sync, layout and drawing.
The Rust side in `src-tauri/src/` does only what a webview cannot do. Each Rust file is one capability.

### The boundary between TypeScript and Rust

The frontend calls Rust through `invoke`. `src-tauri/src/lib.rs` registers every command in `generate_handler!`:

| Rust command | TypeScript caller |
|---|---|
| `hide_shelf_window_command`, `quit_shelf_command` | `src/main.ts` |
| `save_/load_/delete_spotify_refresh_token` | `src/spotify/spotify_access_token_session.ts`, `src/main.ts` |
| `run_spotify_oauth_loopback_authorization` | `src/spotify/spotify_pkce_auth.ts` |
| `write_album_cover_thumbnail_and_sample_colour` | `src/library/album_cover_cache.ts` |
| `launch_spotify_app_in_background` | `src/main.ts` |

Rust sends two events to the frontend: `shelf_window_shown` and `shelf_window_hidden`, from `tray_icon_and_window.rs`.
`src/main.ts` listens for them. It resumes or pauses the renderer and starts or stops the now-playing poller.

`invoke` arguments are camelCase in TypeScript and snake_case in Rust, for example `spotifyRefreshToken`.

To add a command, change three places: the `#[tauri::command]` function, the `generate_handler!` list in `lib.rs`, and the `invoke` call.
To give the frontend a new plugin permission, add it to `src-tauri/capabilities/default.json`.

### Window and process

The app uses `ActivationPolicy::Accessory`, so it has no Dock icon and no app menu. The tray icon is the only entry point.
One window exists, labelled `shelf`. It is hidden, borderless, transparent and always on top until the tray icon shows it.
`tray_icon_and_window.rs` places, shows and hides the `shelf` window.

### Frontend flow

`src/main.ts` holds the app state and switches between two views: `views/spotify_connection_view.ts` and `views/shelf_view.ts`.
At start it loads `app_settings.json`, then shows the demo library, the connection view, or the stored library.
`src/main.ts` syncs the library when the stored copy is older than 6 hours.

- `spotify/`: PKCE sign-in, token session, Web API client with 401 refresh and 429/5xx retry, playback, now-playing poll.
- `library/`: the `SavedAlbum` record, sync, `albums.json` storage, cover download and cache, sort orders.
- `shelf/`: `shelf_layout.ts` is pure geometry and hit testing. `shelf_renderer.ts` draws with PixiJS.
  Only on-screen albums have display objects. Full covers load on demand into an LRU texture cache.
- `demo/`: a generated library of 240 albums with drawn covers, used without a Spotify account.

The app data directory holds `app_settings.json`, `albums.json` and `covers/`. The asset protocol scope allows only `$APPDATA/covers/*`.
The Keychain holds the refresh token. The access token stays in memory only.

### Testing

Tests sit next to their source as `*.test.ts`. They do not use `vi.mock`.
Functions that touch timers, the network or Tauri take those as parameters, for example `wait_milliseconds` and `launch_spotify_app` in `play_spotify_album`. Tests pass fakes.
Rust tests are `#[cfg(test)]` modules in `oauth_loopback_callback_server.rs` and `album_cover_thumbnail_and_colour.rs`.

## Conventions

- Names are long and say exactly what the thing is: `write_album_cover_thumbnail_and_sample_colour`, `saved_albums_library_store.ts`. Follow this.
- TypeScript uses snake_case for files, functions and variables, and PascalCase for types and classes.
- `[profile.dev]` in `Cargo.toml` sets `opt-level = 3`. Without it, the `image` crate decodes covers about 15 times slower.
- `vite.config.ts` forwards webview console output to the `pnpm tauri dev` terminal.
