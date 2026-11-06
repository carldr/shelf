import { describe, expect, it } from "vitest";
import { fetch_spotify_album_tracks, format_album_track_duration } from "./album_tracks";

describe("fetch_spotify_album_tracks", () => {
  it("reads every page of the album's tracks", async () => {
    const pages: Record<string, unknown> = {
      "/albums/a1/tracks?limit=10&offset=0": {
        items: [{ id: "t1", uri: "spotify:track:t1", name: "Opening", duration_ms: 187_000 }],
        next: "https://api.spotify.com/v1/albums/a1/tracks?offset=10&limit=10",
      },
      "https://api.spotify.com/v1/albums/a1/tracks?offset=10&limit=10": {
        items: [{ id: "t2", uri: "spotify:track:t2", name: "Closing", duration_ms: 240_000 }],
        next: null,
      },
    };
    const album_tracks = await fetch_spotify_album_tracks(
      { get_json: async <ResponseBody>(url: string) => pages[url] as ResponseBody },
      "a1",
    );
    expect(album_tracks).toEqual([
      { spotify_track_id: "t1", spotify_track_uri: "spotify:track:t1", track_name: "Opening", duration_ms: 187_000 },
      { spotify_track_id: "t2", spotify_track_uri: "spotify:track:t2", track_name: "Closing", duration_ms: 240_000 },
    ]);
  });
});

describe("format_album_track_duration", () => {
  it("writes minutes and seconds, and hours only when needed", () => {
    expect(format_album_track_duration(187_000)).toBe("3:07");
    expect(format_album_track_duration(59_600)).toBe("1:00");
    expect(format_album_track_duration(3_725_000)).toBe("1:02:05");
  });
});
