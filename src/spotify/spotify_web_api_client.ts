const SPOTIFY_WEB_API_BASE_URL = "https://api.spotify.com/v1";

/** One first attempt plus five retries for 429 and 5xx responses. */
const MAX_REQUEST_ATTEMPTS = 6;
const BACKOFF_BASE_MILLISECONDS = 1000;
const RETRYABLE_SERVER_ERROR_STATUSES = new Set([500, 502, 503, 504]);

export interface SpotifyAccessTokenProvider {
  get_access_token(): Promise<string>;
  refresh_access_token(): Promise<string>;
}

/** Replaceable in tests, so that retries run without real network or real waiting. */
export interface SpotifyWebApiClientDependencies {
  fetch_function: (url: string, request_init?: RequestInit) => Promise<Response>;
  wait_milliseconds: (milliseconds: number) => Promise<void>;
  random_fraction: () => number;
}

const DEFAULT_SPOTIFY_WEB_API_CLIENT_DEPENDENCIES: SpotifyWebApiClientDependencies = {
  fetch_function: (url, request_init) => fetch(url, request_init),
  wait_milliseconds: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  random_fraction: Math.random,
};

export class SpotifyWebApiError extends Error {
  constructor(
    readonly http_status: number,
    readonly spotify_reason: string | null,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Sends authorized requests to the Spotify Web API.
 * After a 401 it refreshes the access token once and retries.
 * After a 429 it waits for Retry-After; after a 429 without it, or a 5xx, it backs off exponentially.
 */
export class SpotifyWebApiClient {
  private readonly dependencies: SpotifyWebApiClientDependencies;

  constructor(
    private readonly access_token_provider: SpotifyAccessTokenProvider,
    dependencies: Partial<SpotifyWebApiClientDependencies> = {},
  ) {
    this.dependencies = { ...DEFAULT_SPOTIFY_WEB_API_CLIENT_DEPENDENCIES, ...dependencies };
  }

  async get_json<ResponseBody>(path_or_url: string): Promise<ResponseBody> {
    const response = await this.send_request(path_or_url, { method: "GET" });
    return (await response.json()) as ResponseBody;
  }

  async send_request(path_or_url: string, request_init: RequestInit): Promise<Response> {
    const url = path_or_url.startsWith("https://") ? path_or_url : SPOTIFY_WEB_API_BASE_URL + path_or_url;
    let access_token = await this.access_token_provider.get_access_token();
    let access_token_was_refreshed = false;

    for (let attempt_number = 1; ; attempt_number += 1) {
      const response = await this.fetch_with_access_token(url, request_init, access_token);

      if (response.status === 401 && !access_token_was_refreshed) {
        access_token = await this.access_token_provider.refresh_access_token();
        access_token_was_refreshed = true;
        attempt_number -= 1;
        continue;
      }
      const is_retryable = response.status === 429 || RETRYABLE_SERVER_ERROR_STATUSES.has(response.status);
      if (is_retryable && attempt_number < MAX_REQUEST_ATTEMPTS) {
        await this.dependencies.wait_milliseconds(this.compute_retry_delay_milliseconds(response, attempt_number));
        continue;
      }
      if (!response.ok) {
        throw await read_spotify_web_api_error(response);
      }
      return response;
    }
  }

  private compute_retry_delay_milliseconds(response: Response, attempt_number: number): number {
    const retry_after_seconds = Number(response.headers.get("Retry-After"));
    if (response.status === 429 && retry_after_seconds > 0) {
      return retry_after_seconds * 1000;
    }
    const jitter_factor = 0.75 + this.dependencies.random_fraction() / 2;
    return BACKOFF_BASE_MILLISECONDS * 2 ** (attempt_number - 1) * jitter_factor;
  }

  private fetch_with_access_token(url: string, request_init: RequestInit, access_token: string): Promise<Response> {
    const headers = new Headers(request_init.headers);
    headers.set("Authorization", `Bearer ${access_token}`);
    return this.dependencies.fetch_function(url, { ...request_init, headers });
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
