import { describe, expect, it } from "vitest";
import { read_now_playing_spotify_album_id, SpotifyNowPlayingPoller } from "./spotify_now_playing_poller";

describe("read_now_playing_spotify_album_id", () => {
  it("reads the album of the current track, playing or paused", () => {
    expect(read_now_playing_spotify_album_id({ is_playing: false, item: { type: "track", album: { id: "a1" } } })).toBe(
      "a1",
    );
  });

  it("returns null for no player, a podcast episode, or no item", () => {
    expect(read_now_playing_spotify_album_id(null)).toBeNull();
    expect(read_now_playing_spotify_album_id({ is_playing: true, item: { type: "episode" } })).toBeNull();
    expect(read_now_playing_spotify_album_id({ is_playing: true, item: null })).toBeNull();
  });
});

describe("SpotifyNowPlayingPoller", () => {
  it("reports a change only when the album changes", async () => {
    const player_states = [
      { is_playing: true, item: { type: "track", album: { id: "a1" } } },
      { is_playing: true, item: { type: "track", album: { id: "a1" } } },
      null,
    ];
    const reported_album_ids: (string | null)[] = [];
    const now_playing_poller = new SpotifyNowPlayingPoller(
      { get_json_or_null: async <ResponseBody>() => player_states.shift() as ResponseBody },
      (now_playing_album_id) => reported_album_ids.push(now_playing_album_id),
    );
    await now_playing_poller.poll_now();
    await now_playing_poller.poll_now();
    await now_playing_poller.poll_now();
    expect(reported_album_ids).toEqual(["a1", null]);
  });
});
