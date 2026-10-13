import { describe, expect, it } from "vitest";
import { SpotifyWebApiClient, SpotifyWebApiError, type SpotifyAccessTokenProvider } from "./spotify_web_api_client";

function create_access_token_provider(): SpotifyAccessTokenProvider & { refresh_count: number } {
  return {
    refresh_count: 0,
    async get_access_token() {
      return `token_${this.refresh_count}`;
    },
    async refresh_access_token() {
      this.refresh_count += 1;
      return `token_${this.refresh_count}`;
    },
  };
}

function create_client_with_responses(responses: Response[]) {
  const sent_authorization_headers: string[] = [];
  const waited_milliseconds: number[] = [];
  const access_token_provider = create_access_token_provider();
  const spotify_web_api_client = new SpotifyWebApiClient(access_token_provider, {
    fetch_function: async (_url, request_init) => {
      sent_authorization_headers.push(new Headers(request_init?.headers).get("Authorization")!);
      const next_response = responses.shift();
      if (!next_response) throw new Error("test ran out of responses");
      return next_response;
    },
    wait_milliseconds: async (milliseconds) => {
      waited_milliseconds.push(milliseconds);
    },
    random_fraction: () => 0.5,
  });
  return { spotify_web_api_client, sent_authorization_headers, waited_milliseconds, access_token_provider };
}

const ok_json_response = () => new Response(JSON.stringify({ ok: true }), { status: 200 });

describe("SpotifyWebApiClient", () => {
  it("waits for Retry-After seconds after a 429, then retries", async () => {
    const { spotify_web_api_client, waited_milliseconds } = create_client_with_responses([
      new Response(null, { status: 429, headers: { "Retry-After": "3" } }),
      ok_json_response(),
    ]);
    await expect(spotify_web_api_client.get_json("/me/albums")).resolves.toEqual({ ok: true });
    expect(waited_milliseconds).toEqual([3000]);
  });

  it("backs off exponentially when a 429 has no Retry-After", async () => {
    const { spotify_web_api_client, waited_milliseconds } = create_client_with_responses([
      new Response(null, { status: 429 }),
      new Response(null, { status: 503 }),
      new Response(null, { status: 429 }),
      ok_json_response(),
    ]);
    await spotify_web_api_client.get_json("/me/albums");
    // 1 s, 2 s, 4 s base, each scaled by a jitter factor of 0.75 + random_fraction / 2 = 1.
    expect(waited_milliseconds).toEqual([1000, 2000, 4000]);
  });

  it("gives up after six attempts and reports the last status", async () => {
    const { spotify_web_api_client, waited_milliseconds } = create_client_with_responses(
      Array.from({ length: 6 }, () => new Response(null, { status: 429, headers: { "Retry-After": "1" } })),
    );
    const request = spotify_web_api_client.get_json("/me/albums");
    await expect(request).rejects.toBeInstanceOf(SpotifyWebApiError);
    await expect(request).rejects.toMatchObject({ http_status: 429 });
    expect(waited_milliseconds).toHaveLength(5);
  });

  it("refreshes the access token once after a 401 and retries with the new token", async () => {
    const { spotify_web_api_client, sent_authorization_headers, access_token_provider } = create_client_with_responses([
      new Response(null, { status: 401 }),
      ok_json_response(),
    ]);
    await spotify_web_api_client.get_json("/me");
    expect(sent_authorization_headers).toEqual(["Bearer token_0", "Bearer token_1"]);
    expect(access_token_provider.refresh_count).toBe(1);
  });

  it("reports Spotify's error reason, such as NO_ACTIVE_DEVICE", async () => {
    const { spotify_web_api_client } = create_client_with_responses([
      new Response(JSON.stringify({ error: { status: 404, message: "Player command failed", reason: "NO_ACTIVE_DEVICE" } }), {
        status: 404,
      }),
    ]);
    await expect(spotify_web_api_client.send_request("/me/player/play", { method: "PUT" })).rejects.toMatchObject({
      http_status: 404,
      spotify_reason: "NO_ACTIVE_DEVICE",
    });
  });
});
