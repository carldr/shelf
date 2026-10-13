import { describe, expect, it } from "vitest";
import {
  choose_spotify_playback_device,
  describe_spotify_playback_error,
  play_spotify_album,
  type SpotifyPlaybackDevice,
} from "./spotify_album_playback";
import { SpotifyWebApiError } from "./spotify_web_api_client";

const phone: SpotifyPlaybackDevice = { id: "phone", name: "Kitchen Speaker", type: "Smartphone", is_active: false };
const this_mac: SpotifyPlaybackDevice = { id: "mac", name: "Office Computer", type: "Computer", is_active: false };
const other_mac: SpotifyPlaybackDevice = { id: "laptop", name: "Work MacBook", type: "Computer", is_active: false };

describe("choose_spotify_playback_device", () => {
  it("prefers the active device", () => {
    expect(choose_spotify_playback_device([this_mac, { ...phone, is_active: true }], "Office-Computer.local")).toBe(
      "phone",
    );
  });

  it("otherwise picks the computer whose name matches this machine's hostname", () => {
    expect(choose_spotify_playback_device([phone, other_mac, this_mac], "Office-Computer.local")).toBe("mac");
  });

  it("ignores the hostname's domain", () => {
    const office-computer: SpotifyPlaybackDevice = { id: "office-computer", name: "office-computer", type: "Computer", is_active: false };
    expect(choose_spotify_playback_device([phone, other_mac, office-computer], "office-computer.example.net")).toBe("office-computer");
  });

  it("uses the only computer when no name matches", () => {
    expect(choose_spotify_playback_device([phone, other_mac], "office-computer.example.net")).toBe("laptop");
  });

  it("returns null when nothing is active, no name matches and there are several computers", () => {
    expect(choose_spotify_playback_device([phone, other_mac, this_mac], "office-computer.example.net")).toBeNull();
  });
});

describe("play_spotify_album", () => {
  function create_playback_dependencies(device_lists: SpotifyPlaybackDevice[][]) {
    const sent_requests: { path: string; body: unknown }[] = [];
    const launched_album_uris: string[] = [];
    return {
      sent_requests,
      launched_album_uris,
      dependencies: {
        spotify_web_api_client: {
          get_json: async <ResponseBody>(path: string) => {
            expect(path).toBe("/me/player/devices");
            return { devices: device_lists.shift() ?? [] } as ResponseBody;
          },
          send_request: async (path: string, request_init: RequestInit) => {
            sent_requests.push({ path, body: JSON.parse(String(request_init.body)) });
            return new Response(null, { status: 204 });
          },
        },
        hostname: "Office-Computer.local",
        launch_spotify_app: async (spotify_album_uri: string) => {
          launched_album_uris.push(spotify_album_uri);
        },
        wait_milliseconds: async () => {},
      },
    };
  }

  it("plays on the chosen device without starting Spotify", async () => {
    const { dependencies, sent_requests, launched_album_uris } = create_playback_dependencies([[this_mac]]);
    await play_spotify_album("spotify:album:abc", dependencies);
    expect(sent_requests).toEqual([
      { path: "/me/player/play?device_id=mac", body: { context_uri: "spotify:album:abc" } },
    ]);
    expect(launched_album_uris).toEqual([]);
  });

  it("starts Spotify, waits for this computer to appear, then plays there", async () => {
    const { dependencies, sent_requests, launched_album_uris } = create_playback_dependencies([
      [phone],
      [phone],
      [phone, this_mac],
    ]);
    await play_spotify_album("spotify:album:abc", dependencies);
    expect(launched_album_uris).toEqual(["spotify:album:abc"]);
    expect(sent_requests).toEqual([
      { path: "/me/player/play?device_id=mac", body: { context_uri: "spotify:album:abc" } },
    ]);
  });

  it("gives up with NO_ACTIVE_DEVICE when Spotify never appears", async () => {
    const { dependencies } = create_playback_dependencies([]);
    await expect(play_spotify_album("spotify:album:abc", dependencies)).rejects.toMatchObject({
      spotify_reason: "NO_ACTIVE_DEVICE",
    });
  });
});

describe("describe_spotify_playback_error", () => {
  it("explains a missing device and a free account in plain words", () => {
    expect(describe_spotify_playback_error(new SpotifyWebApiError(404, "NO_ACTIVE_DEVICE", ""))).toMatch(/Open Spotify/);
    expect(describe_spotify_playback_error(new SpotifyWebApiError(403, "PREMIUM_REQUIRED", ""))).toMatch(/Premium/);
  });
});
