import { openUrl } from "@tauri-apps/plugin-opener";
import { SPOTIFY_REDIRECT_URI } from "../spotify/spotify_pkce_auth";

const SPOTIFY_DEVELOPER_DASHBOARD_URL = "https://developer.spotify.com/dashboard";
const SPOTIFY_CLIENT_ID_PATTERN = /^[0-9a-f]{32}$/i;

export interface SpotifyConnectionViewOptions {
  spotify_client_id: string | null;
  /** Set when Shelf holds a working Spotify login; the view then acts as Settings. */
  connected_spotify_display_name: string | null;
  status_message: string | null;
  on_connect: (spotify_client_id: string) => Promise<void>;
  on_disconnect: () => Promise<void>;
  /** Returns to the library. Only offered while connected or in demo mode. */
  on_done: (() => void) | null;
  /** Shows the generated demo library. Only offered before Spotify is connected. */
  on_try_demo: (() => void) | null;
  on_quit: () => void;
  start_at_login: boolean;
  on_start_at_login_change: (start_at_login: boolean) => void;
}

/**
 * The first-run screen, and the Settings screen once connected.
 * It walks the user through creating their own Spotify app, because Development Mode
 * apps only serve users that the app's owner lists, so Shelf cannot ship a shared Client ID.
 */
export function render_spotify_connection_view(container: HTMLElement, options: SpotifyConnectionViewOptions): void {
  container.innerHTML = `
    <section class="spotify_connection_view">
      <header class="spotify_connection_view_header">
        <h1>${options.connected_spotify_display_name ? "Settings" : "Connect Shelf to Spotify"}</h1>
        <p class="spotify_connection_view_explanation">
          Shelf uses your own Spotify app, so it needs that app's Client ID. There is no client secret.
        </p>
        <p class="spotify_connection_view_status" role="status"></p>
        <div class="spotify_connection_view_header_buttons">
          <button type="button" class="spotify_connection_view_try_demo_button" hidden>Try the demo</button>
          <button type="button" class="spotify_connection_view_disconnect_button" hidden>Disconnect</button>
          <button type="button" class="spotify_connection_view_done_button" hidden>Done</button>
          <button type="button" class="spotify_connection_view_quit_button">Quit</button>
        </div>
        <label class="spotify_connection_view_start_at_login">
          <input type="checkbox" class="spotify_connection_view_start_at_login_checkbox" />
          Start Shelf at login
        </label>
      </header>
      <ol class="spotify_connection_view_steps">
        <li>
          Create an app in the
          <a href="#" class="spotify_connection_view_dashboard_link">Spotify Developer Dashboard</a>
          and select <strong>Web API</strong>.
        </li>
        <li>
          Add this Redirect URI to the app:
          <span class="spotify_connection_view_redirect_uri_row">
            <code>${SPOTIFY_REDIRECT_URI}</code>
            <button type="button" class="spotify_connection_view_copy_button">Copy</button>
          </span>
        </li>
        <li>
          Paste the app's Client ID:
          <form class="spotify_connection_view_client_id_form">
            <input type="text" name="spotify_client_id" spellcheck="false" autocomplete="off"
              placeholder="32 hexadecimal characters" aria-label="Spotify Client ID" />
            <button type="submit">Connect</button>
          </form>
        </li>
      </ol>
    </section>`;

  const status_element = container.querySelector<HTMLElement>(".spotify_connection_view_status")!;
  const client_id_form = container.querySelector<HTMLFormElement>(".spotify_connection_view_client_id_form")!;
  const client_id_input = client_id_form.querySelector<HTMLInputElement>("input")!;
  const connect_button = client_id_form.querySelector<HTMLButtonElement>("button")!;
  const disconnect_button = container.querySelector<HTMLButtonElement>(".spotify_connection_view_disconnect_button")!;
  const done_button = container.querySelector<HTMLButtonElement>(".spotify_connection_view_done_button")!;

  const show_status_message = (status_message: string | null, is_error = false) => {
    status_element.textContent = status_message ?? "";
    status_element.classList.toggle("spotify_connection_view_status_error", is_error);
  };

  client_id_input.value = options.spotify_client_id ?? "";
  if (options.connected_spotify_display_name) {
    show_status_message(`Connected as ${options.connected_spotify_display_name}.`);
    connect_button.textContent = "Reconnect";
    disconnect_button.hidden = false;
  }
  if (options.status_message) {
    show_status_message(options.status_message, true);
  }
  if (options.on_done) {
    done_button.hidden = false;
    done_button.addEventListener("click", options.on_done);
  }
  container.querySelector(".spotify_connection_view_quit_button")!.addEventListener("click", options.on_quit);
  const start_at_login_checkbox = container.querySelector<HTMLInputElement>(
    ".spotify_connection_view_start_at_login_checkbox",
  )!;
  start_at_login_checkbox.checked = options.start_at_login;
  start_at_login_checkbox.addEventListener("change", () =>
    options.on_start_at_login_change(start_at_login_checkbox.checked),
  );
  if (options.on_try_demo) {
    const try_demo_button = container.querySelector<HTMLButtonElement>(".spotify_connection_view_try_demo_button")!;
    try_demo_button.hidden = false;
    try_demo_button.addEventListener("click", options.on_try_demo);
  }

  container.querySelector(".spotify_connection_view_dashboard_link")!.addEventListener("click", (click_event) => {
    click_event.preventDefault();
    void openUrl(SPOTIFY_DEVELOPER_DASHBOARD_URL);
  });

  const copy_button = container.querySelector<HTMLButtonElement>(".spotify_connection_view_copy_button")!;
  copy_button.addEventListener("click", async () => {
    await navigator.clipboard.writeText(SPOTIFY_REDIRECT_URI);
    copy_button.textContent = "Copied";
    setTimeout(() => (copy_button.textContent = "Copy"), 1500);
  });

  client_id_form.addEventListener("submit", async (submit_event) => {
    submit_event.preventDefault();
    const spotify_client_id = client_id_input.value.trim();
    if (!SPOTIFY_CLIENT_ID_PATTERN.test(spotify_client_id)) {
      show_status_message("A Client ID is 32 hexadecimal characters. Copy it from the app's Settings page.", true);
      return;
    }
    connect_button.disabled = true;
    show_status_message("Approve access in your browser…");
    try {
      await options.on_connect(spotify_client_id);
    } catch (connect_error) {
      show_status_message(String(connect_error instanceof Error ? connect_error.message : connect_error), true);
      connect_button.disabled = false;
    }
  });

  disconnect_button.addEventListener("click", () => void options.on_disconnect());
}
