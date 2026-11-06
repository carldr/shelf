import { describe, expect, it } from "vitest";
import {
  read_now_playing_spotify_track,
  SpotifyNowPlayingPoller,
  type SpotifyNowPlayingTrack,
} from "./spotify_now_playing_poller";

describe("read_now_playing_spotify_track", () => {
  it("reads the current track, its album, and whether it plays", () => {
    expect(read_now_playing_spotify_track({ is_playing: false, item: { type: "track", id: "t1", album: { id: "a1" } } })).toEqual({
      spotify_album_id: "a1",
      spotify_track_id: "t1",
      is_playing: false,
    });
    expect(read_now_playing_spotify_track({ is_playing: true, item: { type: "track", id: "t1", album: { id: "a1" } } })).toEqual({
      spotify_album_id: "a1",
      spotify_track_id: "t1",
      is_playing: true,
    });
  });

  it("returns null for no player, a podcast episode, or no item", () => {
    expect(read_now_playing_spotify_track(null)).toBeNull();
    expect(read_now_playing_spotify_track({ is_playing: true, item: { type: "episode" } })).toBeNull();
    expect(read_now_playing_spotify_track({ is_playing: true, item: null })).toBeNull();
  });
});

describe("SpotifyNowPlayingPoller", () => {
  it("reports a change only when the track, its album or the play state changes", async () => {
    const player_states = [
      { is_playing: true, item: { type: "track", id: "t1", album: { id: "a1" } } },
      { is_playing: true, item: { type: "track", id: "t1", album: { id: "a1" } } },
      { is_playing: false, item: { type: "track", id: "t1", album: { id: "a1" } } },
      { is_playing: false, item: { type: "track", id: "t2", album: { id: "a1" } } },
      null,
    ];
    const reported_tracks: (SpotifyNowPlayingTrack | null)[] = [];
    const now_playing_poller = new SpotifyNowPlayingPoller(
      { get_json_or_null: async <ResponseBody>() => player_states.shift() as ResponseBody },
      (now_playing_track) => reported_tracks.push(now_playing_track),
    );
    for (let poll_count = 0; poll_count < 5; poll_count += 1) {
      await now_playing_poller.poll_now();
    }
    expect(reported_tracks).toEqual([
      { spotify_album_id: "a1", spotify_track_id: "t1", is_playing: true },
      { spotify_album_id: "a1", spotify_track_id: "t1", is_playing: false },
      { spotify_album_id: "a1", spotify_track_id: "t2", is_playing: false },
      null,
    ]);
  });
});
