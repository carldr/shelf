import type { SpotifyWebApiClient } from "./spotify_web_api_client";

/** Spotify has no push channel for player state, so Shelf asks this often while the window is open. */
const NOW_PLAYING_POLL_INTERVAL_MS = 5_000;

/** GET /me/player, reduced to the fields Shelf reads. */
export interface SpotifyPlayerState {
  is_playing: boolean;
  item: { type: string; album?: { id: string } } | null;
}

/** The album of the current track, playing or paused. Null for no player or a podcast episode. */
export function read_now_playing_spotify_album_id(spotify_player_state: SpotifyPlayerState | null): string | null {
  const player_item = spotify_player_state?.item;
  return player_item?.type === "track" ? (player_item.album?.id ?? null) : null;
}

/** Polls GET /me/player while started, and reports when the playing album changes. */
export class SpotifyNowPlayingPoller {
  private poll_timer: ReturnType<typeof setInterval> | undefined;
  private now_playing_album_id: string | null | undefined;

  constructor(
    private readonly spotify_web_api_client: Pick<SpotifyWebApiClient, "get_json_or_null">,
    private readonly on_now_playing_album_change: (now_playing_album_id: string | null) => void,
  ) {}

  /** Polls at once and then every few seconds. Call when the window is shown. */
  start(): void {
    this.stop();
    void this.poll_now();
    this.poll_timer = setInterval(() => void this.poll_now(), NOW_PLAYING_POLL_INTERVAL_MS);
  }

  /** Stops polling. Call when the window is hidden. */
  stop(): void {
    clearInterval(this.poll_timer);
    this.poll_timer = undefined;
  }

  /** Returns the playing album, or null; reports it if it changed since the last poll. */
  async poll_now(): Promise<string | null> {
    try {
      const spotify_player_state = await this.spotify_web_api_client.get_json_or_null<SpotifyPlayerState>("/me/player");
      const now_playing_album_id = read_now_playing_spotify_album_id(spotify_player_state);
      if (now_playing_album_id !== this.now_playing_album_id) {
        this.now_playing_album_id = now_playing_album_id;
        this.on_now_playing_album_change(now_playing_album_id);
      }
      return now_playing_album_id;
    } catch (poll_error) {
      console.warn("Shelf could not read the Spotify player state", poll_error);
      return this.now_playing_album_id ?? null;
    }
  }
}
