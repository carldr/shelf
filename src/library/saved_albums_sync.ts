import type { SpotifyWebApiClient } from "../spotify/spotify_web_api_client";
import { cache_album_covers } from "./album_cover_cache";
import { convert_spotify_saved_album_item, type SavedAlbum, type SpotifySavedAlbumItem } from "./saved_album";
import { save_saved_albums_library, type SavedAlbumsLibrary } from "./saved_albums_library_store";

export type SavedAlbumsSyncProgress =
  | { sync_stage: "fetching_albums"; completed_count: number; total_count: number }
  | { sync_stage: "caching_covers"; completed_count: number; total_count: number };

/**
 * Fetches the whole library, caches covers, and writes albums.json.
 * A colour sampled in an earlier sync carries over while the cover URL is unchanged,
 * so that only new covers are decoded.
 */
export async function sync_saved_albums_library(
  spotify_web_api_client: Pick<SpotifyWebApiClient, "get_json">,
  previous_saved_albums_library: SavedAlbumsLibrary | null,
  on_progress: (sync_progress: SavedAlbumsSyncProgress) => void,
): Promise<SavedAlbumsLibrary> {
  const previous_colours_by_cover_image_url = new Map(
    (previous_saved_albums_library?.saved_albums ?? []).map((saved_album) => [
      saved_album.cover_image_url,
      saved_album.cover_dominant_colour,
    ]),
  );
  const fetched_albums = await fetch_all_saved_albums(spotify_web_api_client, (completed_count, total_count) =>
    on_progress({ sync_stage: "fetching_albums", completed_count, total_count }),
  );
  const fetched_albums_with_previous_colours = fetched_albums.map((saved_album) => ({
    ...saved_album,
    cover_dominant_colour: previous_colours_by_cover_image_url.get(saved_album.cover_image_url) ?? null,
  }));
  const saved_albums = await cache_album_covers(fetched_albums_with_previous_colours, (completed_count, total_count) =>
    on_progress({ sync_stage: "caching_covers", completed_count, total_count }),
  );
  const saved_albums_library: SavedAlbumsLibrary = { synced_at: new Date().toISOString(), saved_albums };
  await save_saved_albums_library(saved_albums_library);
  return saved_albums_library;
}

/** Development Mode apps get at most 10 items per page from GET /me/albums. */
const SAVED_ALBUMS_PAGE_SIZE = 10;

interface SpotifySavedAlbumsPage {
  items: SpotifySavedAlbumItem[];
  next: string | null;
  total: number;
}

/** Reads every page of GET /me/albums, following each page's `next` URL. */
export async function fetch_all_saved_albums(
  spotify_web_api_client: Pick<SpotifyWebApiClient, "get_json">,
  on_progress: (fetched_album_count: number, total_album_count: number) => void = () => {},
): Promise<SavedAlbum[]> {
  const saved_albums: SavedAlbum[] = [];
  let next_page_url: string | null = `/me/albums?limit=${SAVED_ALBUMS_PAGE_SIZE}&offset=0`;
  while (next_page_url) {
    const saved_albums_page: SpotifySavedAlbumsPage = await spotify_web_api_client.get_json(next_page_url);
    saved_albums.push(...saved_albums_page.items.map(convert_spotify_saved_album_item));
    on_progress(saved_albums.length, saved_albums_page.total);
    next_page_url = saved_albums_page.next;
  }
  return saved_albums;
}
