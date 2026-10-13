import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { hostname } from "@tauri-apps/plugin-os";
import { load_app_settings, save_app_settings, type AppSettings } from "./app_settings_store";
import { draw_demo_album_cover_bitmap } from "./demo/demo_album_cover";
import { generate_demo_saved_albums } from "./demo/demo_saved_albums";
import {
  ALBUM_COVER_THUMBNAIL_SIZE_PX,
  load_cached_album_cover_bitmap,
  load_cached_album_cover_thumbnail_bitmap,
  resolve_album_covers_directory_path,
} from "./library/album_cover_cache";
import type { SavedAlbum } from "./library/saved_album";
import { sort_saved_albums } from "./library/saved_album_sort_order";
import {
  is_saved_albums_library_stale,
  load_saved_albums_library,
  type SavedAlbumsLibrary,
} from "./library/saved_albums_library_store";
import { sync_saved_albums_library } from "./library/saved_albums_sync";
import { SpotifyAccessTokenSession } from "./spotify/spotify_access_token_session";
import { describe_spotify_playback_error, play_spotify_album } from "./spotify/spotify_album_playback";
import { SpotifyNowPlayingPoller } from "./spotify/spotify_now_playing_poller";
import { authorize_spotify_with_pkce, SpotifyRefreshTokenRejectedError } from "./spotify/spotify_pkce_auth";
import { SpotifyWebApiClient } from "./spotify/spotify_web_api_client";
import { create_shelf_view, type ShelfView } from "./views/shelf_view";
import { render_spotify_connection_view } from "./views/spotify_connection_view";

const shelf_view_root = document.getElementById("shelf_view_root")!;
const spotify_connection_view_root = document.getElementById("spotify_connection_view_root")!;

interface ConnectedSpotifyAccount {
  access_token_session: SpotifyAccessTokenSession;
  spotify_web_api_client: SpotifyWebApiClient;
  spotify_display_name: string;
  now_playing_poller: SpotifyNowPlayingPoller;
}

let app_settings: AppSettings;
let connected_spotify_account: ConnectedSpotifyAccount | null = null;
let saved_albums_library: SavedAlbumsLibrary | null = null;
let shelf_view: ShelfView | null = null;
let library_sync_in_progress = false;
let library_sync_progress_text = "";

document.addEventListener("keydown", (keyboard_event) => {
  if (keyboard_event.key === "Escape") {
    void invoke("hide_shelf_window_command");
  }
});

void listen("tray_menu_open_settings", () => show_spotify_connection_view(null));
void listen("tray_menu_refresh_library", () => void sync_library());
void listen("shelf_window_shown", () => void show_shelf_window_contents());
void listen("shelf_window_hidden", () => {
  shelf_view?.pause();
  connected_spotify_account?.now_playing_poller.stop();
});

/** Resumes drawing, starts the now-playing poll, and opens the playing album in the middle. */
async function show_shelf_window_contents(): Promise<void> {
  if (!shelf_view || shelf_view_root.hidden) {
    return;
  }
  shelf_view.resume();
  const now_playing_poller = connected_spotify_account?.now_playing_poller;
  if (!now_playing_poller) {
    return;
  }
  now_playing_poller.start();
  const now_playing_album_id = await now_playing_poller.poll_now();
  if (now_playing_album_id) {
    shelf_view.jump_to_album(now_playing_album_id);
  }
}

async function play_album_on_spotify(saved_album: SavedAlbum): Promise<void> {
  if (app_settings.demo_mode_enabled) {
    shelf_view?.show_message("This is the demo library. Connect Spotify in Settings to play your own albums.");
    return;
  }
  if (!connected_spotify_account) {
    return;
  }
  const { spotify_web_api_client, now_playing_poller } = connected_spotify_account;
  try {
    await play_spotify_album(saved_album.spotify_album_uri, {
      spotify_web_api_client,
      hostname: (await hostname()) ?? "",
      // Hidden and in the background on macOS; elsewhere, or if that fails, through the spotify: URI.
      launch_spotify_app: (spotify_album_uri) =>
        invoke("launch_spotify_app_in_background").catch(() => openUrl(spotify_album_uri)),
      wait_milliseconds: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    });
    // Spotify takes a moment to report the new album.
    setTimeout(() => void now_playing_poller.poll_now(), 1_000);
  } catch (playback_error) {
    shelf_view?.show_message(describe_spotify_playback_error(playback_error));
  }
}

async function start_shelf(): Promise<void> {
  app_settings = await load_app_settings();
  await resolve_album_covers_directory_path();
  if (app_settings.demo_mode_enabled) {
    await show_demo_library();
    return;
  }
  if (!app_settings.spotify_client_id) {
    show_spotify_connection_view(null);
    return;
  }
  try {
    const access_token_session = await SpotifyAccessTokenSession.start_from_keychain(app_settings.spotify_client_id);
    if (!access_token_session) {
      show_spotify_connection_view(null);
      return;
    }
    connected_spotify_account = await connect_spotify_account(access_token_session);
  } catch (start_error) {
    if (start_error instanceof SpotifyRefreshTokenRejectedError) {
      await invoke("delete_spotify_refresh_token");
    }
    show_spotify_connection_view(start_error instanceof Error ? start_error.message : String(start_error));
    return;
  }
  saved_albums_library = await load_saved_albums_library();
  if (is_saved_albums_library_stale(saved_albums_library)) {
    // Starts before the shelf shows, so the shelf opens behind the sync spinner.
    void sync_library();
  }
  await show_library_view();
}

async function connect_spotify_account(
  access_token_session: SpotifyAccessTokenSession,
): Promise<ConnectedSpotifyAccount> {
  const spotify_web_api_client = new SpotifyWebApiClient(access_token_session);
  const spotify_current_user = await spotify_web_api_client.get_json<{ id: string; display_name: string | null }>("/me");
  return {
    access_token_session,
    spotify_web_api_client,
    spotify_display_name: spotify_current_user.display_name ?? spotify_current_user.id,
    now_playing_poller: new SpotifyNowPlayingPoller(spotify_web_api_client, (now_playing_album_id) =>
      shelf_view?.set_now_playing_album(now_playing_album_id),
    ),
  };
}

function show_spotify_connection_view(status_message: string | null): void {
  shelf_view_root.hidden = true;
  shelf_view?.pause();
  spotify_connection_view_root.hidden = false;
  render_spotify_connection_view(spotify_connection_view_root, {
    spotify_client_id: app_settings.spotify_client_id,
    connected_spotify_display_name: connected_spotify_account?.spotify_display_name ?? null,
    status_message,
    on_connect: async (spotify_client_id) => {
      const token_response = await authorize_spotify_with_pkce(spotify_client_id);
      app_settings = { ...app_settings, spotify_client_id };
      await save_app_settings(app_settings);
      connected_spotify_account?.now_playing_poller.stop();
      await connected_spotify_account?.access_token_session.disconnect();
      const access_token_session = await SpotifyAccessTokenSession.start_from_authorization(
        spotify_client_id,
        token_response,
      );
      connected_spotify_account = await connect_spotify_account(access_token_session);
      if (app_settings.demo_mode_enabled) {
        app_settings = { ...app_settings, demo_mode_enabled: false };
        await save_app_settings(app_settings);
      }
      // The new login can be a different Spotify account, so the stored library is synced again.
      saved_albums_library = await load_saved_albums_library();
      void sync_library();
      await show_library_view();
    },
    on_disconnect: async () => {
      connected_spotify_account?.now_playing_poller.stop();
      await connected_spotify_account?.access_token_session.disconnect();
      connected_spotify_account = null;
      show_spotify_connection_view(null);
    },
    on_done: connected_spotify_account || app_settings.demo_mode_enabled ? () => void show_library_view() : null,
    on_try_demo:
      connected_spotify_account || app_settings.demo_mode_enabled
        ? null
        : async () => {
            app_settings = { ...app_settings, demo_mode_enabled: true };
            await save_app_settings(app_settings);
            await show_demo_library();
          },
  });
}

/** Shows the generated library. It lives in memory only; nothing is written to albums.json. */
async function show_demo_library(): Promise<void> {
  saved_albums_library = { synced_at: new Date().toISOString(), saved_albums: generate_demo_saved_albums() };
  await show_library_view();
}

async function show_library_view(): Promise<void> {
  spotify_connection_view_root.hidden = true;
  shelf_view_root.hidden = false;
  shelf_view ??= await create_shelf_view(shelf_view_root, {
    saved_album_sort_order: app_settings.saved_album_sort_order,
    on_sort_order_change: (saved_album_sort_order) => {
      app_settings = { ...app_settings, saved_album_sort_order };
      void save_app_settings(app_settings);
      show_sorted_albums();
    },
    on_refresh_library: () => void sync_library(),
    on_open_settings: () => show_spotify_connection_view(null),
    on_album_click: (saved_album) => void play_album_on_spotify(saved_album),
    load_cover_bitmap: (saved_album, size_px) =>
      app_settings.demo_mode_enabled
        ? draw_demo_album_cover_bitmap(saved_album, size_px)
        : load_cached_album_cover_bitmap(saved_album, size_px),
    load_cover_thumbnail_bitmap: (saved_album) =>
      app_settings.demo_mode_enabled
        ? draw_demo_album_cover_bitmap(saved_album, ALBUM_COVER_THUMBNAIL_SIZE_PX)
        : load_cached_album_cover_thumbnail_bitmap(saved_album),
  });
  shelf_view.resume();
  if (library_sync_in_progress) {
    shelf_view.show_sync_in_progress(library_sync_progress_text);
    return;
  }
  show_sorted_albums();
  if (app_settings.demo_mode_enabled) {
    shelf_view.show_sync_status("Demo library. Connect Spotify in Settings to see your own albums.");
  } else if (saved_albums_library) {
    shelf_view.show_sync_status(`Synced ${new Date(saved_albums_library.synced_at).toLocaleString()}`);
  }
}

function show_sorted_albums(): void {
  shelf_view?.show_albums(
    sort_saved_albums(saved_albums_library?.saved_albums ?? [], app_settings.saved_album_sort_order),
  );
}

async function sync_library(): Promise<void> {
  if (!connected_spotify_account || library_sync_in_progress) {
    return;
  }
  library_sync_in_progress = true;
  show_library_sync_progress("Syncing…");
  let sync_status_text: string;
  try {
    saved_albums_library = await sync_saved_albums_library(
      connected_spotify_account.spotify_web_api_client,
      saved_albums_library,
      (sync_progress) =>
        show_library_sync_progress(
          sync_progress.sync_stage === "fetching_albums"
            ? `Fetching albums ${sync_progress.completed_count} of ${sync_progress.total_count}`
            : `Caching covers ${sync_progress.completed_count} of ${sync_progress.total_count}`,
        ),
    );
    sync_status_text = `Synced ${new Date(saved_albums_library.synced_at).toLocaleString()}`;
  } catch (sync_error) {
    sync_status_text = `Sync failed: ${sync_error instanceof Error ? sync_error.message : String(sync_error)}`;
  }
  library_sync_in_progress = false;
  shelf_view?.show_sync_in_progress(null);
  // After a failed sync the shelf shows the library from before it.
  show_sorted_albums();
  shelf_view?.show_sync_status(sync_status_text);
}

/** Keeps the text for a shelf view created during the sync, and shows it on the current one. */
function show_library_sync_progress(sync_progress_text: string): void {
  library_sync_progress_text = sync_progress_text;
  shelf_view?.show_sync_in_progress(sync_progress_text);
}

void start_shelf();
