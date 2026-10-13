import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { load_app_settings, save_app_settings, type AppSettings } from "./app_settings_store";
import { resolve_album_covers_directory_path } from "./library/album_cover_cache";
import { sort_saved_albums } from "./library/saved_album_sort_order";
import {
  is_saved_albums_library_stale,
  load_saved_albums_library,
  type SavedAlbumsLibrary,
} from "./library/saved_albums_library_store";
import { sync_saved_albums_library } from "./library/saved_albums_sync";
import { SpotifyAccessTokenSession } from "./spotify/spotify_access_token_session";
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
}

let app_settings: AppSettings;
let connected_spotify_account: ConnectedSpotifyAccount | null = null;
let saved_albums_library: SavedAlbumsLibrary | null = null;
let shelf_view: ShelfView | null = null;
let library_sync_in_progress = false;

document.addEventListener("keydown", (keyboard_event) => {
  if (keyboard_event.key === "Escape") {
    void invoke("hide_shelf_window_command");
  }
});

void listen("tray_menu_open_settings", () => show_spotify_connection_view(null));
void listen("tray_menu_refresh_library", () => void sync_library());
void listen("shelf_window_shown", () => shelf_view?.resume());
void listen("shelf_window_hidden", () => shelf_view?.pause());

async function start_shelf(): Promise<void> {
  app_settings = await load_app_settings();
  await resolve_album_covers_directory_path();
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
  await show_library_view();
  if (is_saved_albums_library_stale(saved_albums_library)) {
    await sync_library();
  }
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
      await connected_spotify_account?.access_token_session.disconnect();
      const access_token_session = await SpotifyAccessTokenSession.start_from_authorization(
        spotify_client_id,
        token_response,
      );
      connected_spotify_account = await connect_spotify_account(access_token_session);
      // The new login can be a different Spotify account, so the stored library is not trusted.
      await show_library_view();
      await sync_library();
    },
    on_disconnect: async () => {
      await connected_spotify_account?.access_token_session.disconnect();
      connected_spotify_account = null;
      show_spotify_connection_view(null);
    },
    on_done: connected_spotify_account ? () => void show_library_view() : null,
  });
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
    on_album_click: (saved_album) => console.info("Shelf album clicked", saved_album.spotify_album_uri),
  });
  shelf_view.resume();
  show_sorted_albums();
  if (library_sync_in_progress) {
    shelf_view.show_sync_status("Syncing…");
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
  shelf_view?.show_sync_status("Syncing…");
  try {
    saved_albums_library = await sync_saved_albums_library(
      connected_spotify_account.spotify_web_api_client,
      saved_albums_library,
      (sync_progress) =>
        shelf_view?.show_sync_status(
          sync_progress.sync_stage === "fetching_albums"
            ? `Fetching albums ${sync_progress.completed_count} of ${sync_progress.total_count}`
            : `Caching covers ${sync_progress.completed_count} of ${sync_progress.total_count}`,
        ),
    );
    show_sorted_albums();
    shelf_view?.show_sync_status(`Synced ${new Date(saved_albums_library.synced_at).toLocaleString()}`);
  } catch (sync_error) {
    shelf_view?.show_sync_status(
      `Sync failed: ${sync_error instanceof Error ? sync_error.message : String(sync_error)}`,
    );
  } finally {
    library_sync_in_progress = false;
  }
}

void start_shelf();
