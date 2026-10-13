import type { SavedAlbum } from "./saved_album";

export type SavedAlbumSortOrder = "recently_added" | "artist_a_to_z" | "album_name_a_to_z" | "release_year";

export const SAVED_ALBUM_SORT_ORDER_LABELS: Record<SavedAlbumSortOrder, string> = {
  recently_added: "Recently added",
  artist_a_to_z: "Artist A–Z",
  album_name_a_to_z: "Album A–Z",
  release_year: "Release year",
};

const name_collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

/** Files "The Beatles" under B and "The Bends" under B, as a record shop does. */
function filing_name(artist_or_album_name: string): string {
  return artist_or_album_name.replace(/^the\s+/i, "");
}

function compare_by_artist_then_release_year(first_album: SavedAlbum, second_album: SavedAlbum): number {
  return (
    name_collator.compare(filing_name(first_album.artist_names), filing_name(second_album.artist_names)) ||
    (first_album.release_year ?? 0) - (second_album.release_year ?? 0) ||
    name_collator.compare(first_album.album_name, second_album.album_name)
  );
}

/** Returns a new array; `saved_albums` is not changed. */
export function sort_saved_albums(saved_albums: readonly SavedAlbum[], sort_order: SavedAlbumSortOrder): SavedAlbum[] {
  const sorted_albums = [...saved_albums];
  switch (sort_order) {
    case "recently_added":
      return sorted_albums.sort((first_album, second_album) => second_album.added_at.localeCompare(first_album.added_at));
    case "artist_a_to_z":
      return sorted_albums.sort(compare_by_artist_then_release_year);
    case "album_name_a_to_z":
      return sorted_albums.sort(
        (first_album, second_album) =>
          name_collator.compare(filing_name(first_album.album_name), filing_name(second_album.album_name)) ||
          compare_by_artist_then_release_year(first_album, second_album),
      );
    case "release_year":
      // Oldest first. Albums without a year go last.
      return sorted_albums.sort(
        (first_album, second_album) =>
          (first_album.release_year ?? Infinity) - (second_album.release_year ?? Infinity) ||
          compare_by_artist_then_release_year(first_album, second_album),
      );
  }
}
