import type { SpotifyWebApiClient } from "../spotify/spotify_web_api_client";
import { convert_spotify_saved_album_item, type SavedAlbum, type SpotifySavedAlbumItem } from "./saved_album";

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
