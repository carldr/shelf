import { invoke } from "@tauri-apps/api/core";

/** Must match OAUTH_LOOPBACK_CALLBACK_PORT and the path in oauth_loopback_callback_server.rs. */
export const SPOTIFY_REDIRECT_URI = "http://127.0.0.1:43821/callback";

const SPOTIFY_SCOPES = ["user-library-read", "user-read-playback-state", "user-modify-playback-state"];
const SPOTIFY_AUTHORIZE_URL = "https://accounts.spotify.com/authorize";
const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";

const PKCE_UNRESERVED_CHARACTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";

export interface SpotifyTokenResponse {
  access_token: string;
  expires_in: number;
  /** Spotify can omit this on refresh; the previous refresh token then stays valid. */
  refresh_token?: string;
}

/** Spotify refused the refresh token, for example because the user removed Shelf's access. */
export class SpotifyRefreshTokenRejectedError extends Error {}

export function generate_pkce_code_verifier(): string {
  const random_bytes = crypto.getRandomValues(new Uint8Array(64));
  return Array.from(random_bytes, (random_byte) => PKCE_UNRESERVED_CHARACTERS[random_byte % 66]).join("");
}

export async function compute_pkce_code_challenge(code_verifier: string): Promise<string> {
  const sha256_digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(code_verifier));
  return encode_base64url(new Uint8Array(sha256_digest));
}

function encode_base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function build_spotify_authorize_url(authorize_request: {
  spotify_client_id: string;
  code_challenge: string;
  state: string;
}): string {
  const query = new URLSearchParams({
    client_id: authorize_request.spotify_client_id,
    response_type: "code",
    redirect_uri: SPOTIFY_REDIRECT_URI,
    code_challenge_method: "S256",
    code_challenge: authorize_request.code_challenge,
    state: authorize_request.state,
    scope: SPOTIFY_SCOPES.join(" "),
  });
  return `${SPOTIFY_AUTHORIZE_URL}?${query}`;
}

export function read_spotify_authorization_code_from_callback(callback_query_string: string, expected_state: string): string {
  const callback_query = new URLSearchParams(callback_query_string);
  if (callback_query.get("state") !== expected_state) {
    throw new Error("Spotify's redirect carried the wrong state value. Try connecting again.");
  }
  const spotify_error = callback_query.get("error");
  if (spotify_error === "access_denied") {
    throw new Error("Access was denied in the browser.");
  }
  if (spotify_error) {
    throw new Error(`Spotify refused the authorization: ${spotify_error}`);
  }
  const authorization_code = callback_query.get("code");
  if (!authorization_code) {
    throw new Error("Spotify's redirect had no authorization code.");
  }
  return authorization_code;
}

/** Opens Spotify's consent page in the browser and returns tokens once the user approves. */
export async function authorize_spotify_with_pkce(spotify_client_id: string): Promise<SpotifyTokenResponse> {
  const code_verifier = generate_pkce_code_verifier();
  const state = generate_pkce_code_verifier();
  const spotify_authorize_url = build_spotify_authorize_url({
    spotify_client_id,
    code_challenge: await compute_pkce_code_challenge(code_verifier),
    state,
  });
  const callback_query_string = await invoke<string>("run_spotify_oauth_loopback_authorization", {
    spotifyAuthorizeUrl: spotify_authorize_url,
  });
  const authorization_code = read_spotify_authorization_code_from_callback(callback_query_string, state);
  return request_spotify_tokens({
    grant_type: "authorization_code",
    code: authorization_code,
    redirect_uri: SPOTIFY_REDIRECT_URI,
    client_id: spotify_client_id,
    code_verifier,
  });
}

export async function refresh_spotify_access_token(
  spotify_client_id: string,
  spotify_refresh_token: string,
): Promise<SpotifyTokenResponse> {
  return request_spotify_tokens({
    grant_type: "refresh_token",
    refresh_token: spotify_refresh_token,
    client_id: spotify_client_id,
  });
}

async function request_spotify_tokens(token_request_form: Record<string, string>): Promise<SpotifyTokenResponse> {
  const token_response = await fetch(SPOTIFY_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(token_request_form),
  });
  if (token_response.ok) {
    return (await token_response.json()) as SpotifyTokenResponse;
  }
  const token_error = (await token_response.json().catch(() => ({}))) as {
    error?: string;
    error_description?: string;
  };
  if (token_request_form.grant_type === "refresh_token" && token_error.error === "invalid_grant") {
    throw new SpotifyRefreshTokenRejectedError("Spotify no longer accepts Shelf's saved login. Connect again.");
  }
  throw new Error(
    `Spotify token request failed (${token_response.status}): ${token_error.error_description ?? token_error.error ?? "no detail"}`,
  );
}
