import { describe, expect, it } from "vitest";
import {
  read_now_playing_spotify_album,
  SpotifyNowPlayingPoller,
  type SpotifyNowPlayingAlbum,
} from "./spotify_now_playing_poller";

describe("read_now_playing_spotify_album", () => {
  it("reads the album of the current track and whether it plays", () => {
    expect(read_now_playing_spotify_album({ is_playing: false, item: { type: "track", album: { id: "a1" } } })).toEqual({
      spotify_album_id: "a1",
      is_playing: false,
    });
    expect(read_now_playing_spotify_album({ is_playing: true, item: { type: "track", album: { id: "a1" } } })).toEqual({
      spotify_album_id: "a1",
      is_playing: true,
    });
  });

  it("returns null for no player, a podcast episode, or no item", () => {
    expect(read_now_playing_spotify_album(null)).toBeNull();
    expect(read_now_playing_spotify_album({ is_playing: true, item: { type: "episode" } })).toBeNull();
    expect(read_now_playing_spotify_album({ is_playing: true, item: null })).toBeNull();
  });
});

describe("SpotifyNowPlayingPoller", () => {
  it("reports a change only when the album or its play state changes", async () => {
    const player_states = [
      { is_playing: true, item: { type: "track", album: { id: "a1" } } },
      { is_playing: true, item: { type: "track", album: { id: "a1" } } },
      { is_playing: false, item: { type: "track", album: { id: "a1" } } },
      null,
    ];
    const reported_albums: (SpotifyNowPlayingAlbum | null)[] = [];
    const now_playing_poller = new SpotifyNowPlayingPoller(
      { get_json_or_null: async <ResponseBody>() => player_states.shift() as ResponseBody },
      (now_playing_album) => reported_albums.push(now_playing_album),
    );
    for (let poll_count = 0; poll_count < 4; poll_count += 1) {
      await now_playing_poller.poll_now();
    }
    expect(reported_albums).toEqual([
      { spotify_album_id: "a1", is_playing: true },
      { spotify_album_id: "a1", is_playing: false },
      null,
    ]);
  });
});
