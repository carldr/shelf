import type { SpotifyWebApiClient } from "./spotify_web_api_client";

/** Spotify has no push channel for player state, so Shelf asks this often while the window is open. */
const NOW_PLAYING_POLL_INTERVAL_MS = 5_000;

/** GET /me/player, reduced to the fields Shelf reads. */
export interface SpotifyPlayerState {
  is_playing: boolean;
  item: { type: string; id?: string; album?: { id: string } } | null;
}

/** The current track and its album, and whether it plays or is paused. */
export interface SpotifyNowPlayingTrack {
  spotify_album_id: string;
  spotify_track_id: string;
  is_playing: boolean;
}

/** The album of the current track, playing or paused. Null for no player or a podcast episode. */
export function read_now_playing_spotify_track(
  spotify_player_state: SpotifyPlayerState | null,
): SpotifyNowPlayingTrack | null {
  const player_item = spotify_player_state?.item;
  if (!spotify_player_state || player_item?.type !== "track" || !player_item.album?.id || !player_item.id) {
    return null;
  }
  return {
    spotify_album_id: player_item.album.id,
    spotify_track_id: player_item.id,
    is_playing: spotify_player_state.is_playing,
  };
}

/** Polls GET /me/player while started, and reports when the track, its album or the play state changes. */
export class SpotifyNowPlayingPoller {
  private poll_timer: ReturnType<typeof setInterval> | undefined;
  private now_playing_track: SpotifyNowPlayingTrack | null | undefined;

  constructor(
    private readonly spotify_web_api_client: Pick<SpotifyWebApiClient, "get_json_or_null">,
    private readonly on_now_playing_track_change: (now_playing_track: SpotifyNowPlayingTrack | null) => void,
  ) {}

  /** Polls every few seconds. Call when the window is shown, together with poll_now for the first result. */
  start(): void {
    this.stop();
    this.poll_timer = setInterval(() => void this.poll_now(), NOW_PLAYING_POLL_INTERVAL_MS);
  }

  /** The result of the last successful poll, or null before the first one. */
  get last_now_playing_track(): SpotifyNowPlayingTrack | null {
    return this.now_playing_track ?? null;
  }

  /** Stops polling. Call when the window is hidden. */
  stop(): void {
    clearInterval(this.poll_timer);
    this.poll_timer = undefined;
  }

  /** Returns the album of the current track, or null; reports it if it changed since the last poll. */
  async poll_now(): Promise<SpotifyNowPlayingTrack | null> {
    try {
      const spotify_player_state = await this.spotify_web_api_client.get_json_or_null<SpotifyPlayerState>("/me/player");
      const now_playing_track = read_now_playing_spotify_track(spotify_player_state);
      if (
        this.now_playing_track === undefined ||
        now_playing_track?.spotify_album_id !== this.now_playing_track?.spotify_album_id ||
        now_playing_track?.spotify_track_id !== this.now_playing_track?.spotify_track_id ||
        now_playing_track?.is_playing !== this.now_playing_track?.is_playing
      ) {
        this.now_playing_track = now_playing_track;
        this.on_now_playing_track_change(now_playing_track);
      }
      return now_playing_track;
    } catch (poll_error) {
      console.warn("Shelf could not read the Spotify player state", poll_error);
      return this.now_playing_track ?? null;
    }
  }
}
