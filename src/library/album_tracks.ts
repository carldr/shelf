import type { SpotifyWebApiClient } from "../spotify/spotify_web_api_client";

/** One track on an album, as the back of the album lists it. */
export interface AlbumTrack {
  spotify_track_id: string;
  spotify_track_uri: string;
  track_name: string;
  duration_ms: number;
}

/**
 * An album's tracks for the back of the album: the tracks stored at sync, shown at once,
 * and a read of the rest when the sync could not store them all.
 */
export interface AlbumTracksLoad {
  stored_album_tracks: AlbumTrack[];
  /** The tracks after the stored ones, or null when the stored ones are all of them. */
  remaining_album_tracks: Promise<AlbumTrack[]> | null;
  /** Every track on the album, stored and remaining. */
  album_track_count: number;
}

/** Development Mode apps get at most 10 items per page from GET /me/albums, so the track list uses the same size. */
const ALBUM_TRACKS_PAGE_SIZE = 10;

/** A track in GET /albums/{id}/tracks, and in the album of each GET /me/albums item, reduced to the fields Shelf reads. */
export interface SpotifySimplifiedTrack {
  id: string;
  uri: string;
  name: string;
  duration_ms: number;
}

/** A page of an album's tracks. */
export interface SpotifyAlbumTracksPage {
  items: SpotifySimplifiedTrack[];
  next: string | null;
  total: number;
}

export function convert_spotify_simplified_track(spotify_track: SpotifySimplifiedTrack): AlbumTrack {
  return {
    spotify_track_id: spotify_track.id,
    spotify_track_uri: spotify_track.uri,
    track_name: spotify_track.name,
    duration_ms: spotify_track.duration_ms,
  };
}

/** Reads the pages of GET /albums/{id}/tracks from track `start_offset` on, following each page's `next` URL. */
export async function fetch_spotify_album_tracks(
  spotify_web_api_client: Pick<SpotifyWebApiClient, "get_json">,
  spotify_album_id: string,
  start_offset = 0,
): Promise<AlbumTrack[]> {
  const album_tracks: AlbumTrack[] = [];
  let next_page_url: string | null =
    `/albums/${encodeURIComponent(spotify_album_id)}/tracks?limit=${ALBUM_TRACKS_PAGE_SIZE}&offset=${start_offset}`;
  while (next_page_url) {
    const album_tracks_page: SpotifyAlbumTracksPage = await spotify_web_api_client.get_json(next_page_url);
    album_tracks.push(...album_tracks_page.items.map(convert_spotify_simplified_track));
    next_page_url = album_tracks_page.next;
  }
  return album_tracks;
}

/** "3:07" for 187,000 ms; "1:02:05" for a track over an hour. */
export function format_album_track_duration(duration_ms: number): string {
  const total_seconds = Math.round(duration_ms / 1000);
  const hours = Math.floor(total_seconds / 3600);
  const minutes = Math.floor((total_seconds % 3600) / 60);
  const seconds = String(total_seconds % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}` : `${minutes}:${seconds}`;
}
