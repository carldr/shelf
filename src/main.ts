import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { load_app_settings, save_app_settings, type AppSettings } from "./app_settings_store";
import { SpotifyAccessTokenSession } from "./spotify/spotify_access_token_session";
import { authorize_spotify_with_pkce, SpotifyRefreshTokenRejectedError } from "./spotify/spotify_pkce_auth";
import { SpotifyWebApiClient } from "./spotify/spotify_web_api_client";
import { render_spotify_connection_view } from "./views/spotify_connection_view";

const app_root = document.getElementById("app_root")!;

interface ConnectedSpotifyAccount {
  access_token_session: SpotifyAccessTokenSession;
  spotify_web_api_client: SpotifyWebApiClient;
  spotify_display_name: string;
}

let app_settings: AppSettings;
let connected_spotify_account: ConnectedSpotifyAccount | null = null;

document.addEventListener("keydown", (keyboard_event) => {
  if (keyboard_event.key === "Escape") {
    void invoke("hide_shelf_window_command");
  }
});

void listen("tray_menu_open_settings", () => show_spotify_connection_view(null));

async function start_shelf(): Promise<void> {
  app_settings = await load_app_settings();
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
    show_library_view();
  } catch (start_error) {
    if (start_error instanceof SpotifyRefreshTokenRejectedError) {
      await invoke("delete_spotify_refresh_token");
    }
    show_spotify_connection_view(start_error instanceof Error ? start_error.message : String(start_error));
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
  render_spotify_connection_view(app_root, {
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
      show_library_view();
    },
    on_disconnect: async () => {
      await connected_spotify_account?.access_token_session.disconnect();
      connected_spotify_account = null;
      show_spotify_connection_view(null);
    },
    on_done: connected_spotify_account ? show_library_view : null,
  });
}

/** Placeholder until library sync lands in milestone 3. */
function show_library_view(): void {
  app_root.textContent = `Connected as ${connected_spotify_account!.spotify_display_name}.`;
}

void start_shelf();
