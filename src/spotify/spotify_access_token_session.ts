import { invoke } from "@tauri-apps/api/core";
import { refresh_spotify_access_token, type SpotifyTokenResponse } from "./spotify_pkce_auth";

/** Refresh this long before Spotify's stated expiry, so that no request carries an expired token. */
const ACCESS_TOKEN_REFRESH_MARGIN_MS = 60_000;

/**
 * Holds the current Spotify access token in memory and refreshes it in the background.
 * The refresh token lives in the Keychain; a rotated refresh token replaces the stored one.
 */
export class SpotifyAccessTokenSession {
  private access_token = "";
  private access_token_expiry_time_ms = 0;
  private pending_refresh: Promise<string> | null = null;
  private background_refresh_timer: ReturnType<typeof setTimeout> | undefined;

  private constructor(
    private readonly spotify_client_id: string,
    private spotify_refresh_token: string,
  ) {}

  /** Returns null when the Keychain holds no refresh token, i.e. Shelf has never connected. */
  static async start_from_keychain(spotify_client_id: string): Promise<SpotifyAccessTokenSession | null> {
    const spotify_refresh_token = await invoke<string | null>("load_spotify_refresh_token");
    if (!spotify_refresh_token) {
      return null;
    }
    const session = new SpotifyAccessTokenSession(spotify_client_id, spotify_refresh_token);
    await session.refresh_access_token();
    return session;
  }

  /** Starts a session from the tokens of a completed authorization and saves the refresh token. */
  static async start_from_authorization(
    spotify_client_id: string,
    token_response: SpotifyTokenResponse,
  ): Promise<SpotifyAccessTokenSession> {
    if (!token_response.refresh_token) {
      throw new Error("Spotify's authorization response had no refresh token.");
    }
    const session = new SpotifyAccessTokenSession(spotify_client_id, token_response.refresh_token);
    await invoke("save_spotify_refresh_token", { spotifyRefreshToken: token_response.refresh_token });
    session.accept_token_response(token_response);
    return session;
  }

  async get_access_token(): Promise<string> {
    if (Date.now() < this.access_token_expiry_time_ms - ACCESS_TOKEN_REFRESH_MARGIN_MS) {
      return this.access_token;
    }
    return this.refresh_access_token();
  }

  /** Concurrent callers share one refresh request. Call this after a 401 from the Web API. */
  refresh_access_token(): Promise<string> {
    this.pending_refresh ??= refresh_spotify_access_token(this.spotify_client_id, this.spotify_refresh_token)
      .then(async (token_response) => {
        if (token_response.refresh_token && token_response.refresh_token !== this.spotify_refresh_token) {
          this.spotify_refresh_token = token_response.refresh_token;
          await invoke("save_spotify_refresh_token", { spotifyRefreshToken: token_response.refresh_token });
        }
        this.accept_token_response(token_response);
        return this.access_token;
      })
      .finally(() => {
        this.pending_refresh = null;
      });
    return this.pending_refresh;
  }

  /** Stops the background refresh and removes the refresh token from the Keychain. */
  async disconnect(): Promise<void> {
    clearTimeout(this.background_refresh_timer);
    await invoke("delete_spotify_refresh_token");
  }

  private accept_token_response(token_response: SpotifyTokenResponse): void {
    this.access_token = token_response.access_token;
    this.access_token_expiry_time_ms = Date.now() + token_response.expires_in * 1000;
    clearTimeout(this.background_refresh_timer);
    this.background_refresh_timer = setTimeout(
      () => void this.refresh_access_token().catch((refresh_error) => console.warn(refresh_error)),
      token_response.expires_in * 1000 - ACCESS_TOKEN_REFRESH_MARGIN_MS,
    );
  }
}
