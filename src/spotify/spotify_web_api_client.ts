import type { SpotifyAccessTokenSession } from "./spotify_access_token_session";

const SPOTIFY_WEB_API_BASE_URL = "https://api.spotify.com/v1";

export class SpotifyWebApiError extends Error {
  constructor(
    readonly http_status: number,
    readonly spotify_reason: string | null,
    message: string,
  ) {
    super(message);
  }
}

/** Sends authorized requests to the Spotify Web API and retries once with a fresh token after a 401. */
export class SpotifyWebApiClient {
  constructor(private readonly access_token_session: SpotifyAccessTokenSession) {}

  async get_json<ResponseBody>(path_or_url: string): Promise<ResponseBody> {
    const response = await this.send_request(path_or_url, { method: "GET" });
    return (await response.json()) as ResponseBody;
  }

  async send_request(path_or_url: string, request_init: RequestInit): Promise<Response> {
    const url = path_or_url.startsWith("https://") ? path_or_url : SPOTIFY_WEB_API_BASE_URL + path_or_url;
    let response = await this.fetch_with_access_token(url, request_init, await this.access_token_session.get_access_token());
    if (response.status === 401) {
      response = await this.fetch_with_access_token(
        url,
        request_init,
        await this.access_token_session.refresh_access_token(),
      );
    }
    if (!response.ok) {
      throw await read_spotify_web_api_error(response);
    }
    return response;
  }

  private fetch_with_access_token(url: string, request_init: RequestInit, access_token: string): Promise<Response> {
    const headers = new Headers(request_init.headers);
    headers.set("Authorization", `Bearer ${access_token}`);
    return fetch(url, { ...request_init, headers });
  }
}

async function read_spotify_web_api_error(response: Response): Promise<SpotifyWebApiError> {
  const error_body = (await response.json().catch(() => ({}))) as {
    error?: { message?: string; reason?: string };
  };
  return new SpotifyWebApiError(
    response.status,
    error_body.error?.reason ?? null,
    `Spotify Web API request failed (${response.status}): ${error_body.error?.message ?? response.statusText}`,
  );
}
