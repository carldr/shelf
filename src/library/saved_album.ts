/** One album in the user's Spotify library, as Shelf stores it in albums.json. */
export interface SavedAlbum {
  spotify_album_id: string;
  spotify_album_uri: string;
  album_name: string;
  /** Artist names joined with ", ". */
  artist_names: string;
  release_year: number | null;
  /** When the user saved the album, as an ISO 8601 timestamp. */
  added_at: string;
  /** The Spotify image closest to 640 px wide, or null when the album has no image. */
  cover_image_url: string | null;
  /** "#rrggbb", sampled once from the cached cover. Null until the cover is cached. */
  cover_dominant_colour: string | null;
}

/** An open cover is about 320 pt, which is 640 px on a Retina display. */
const PREFERRED_COVER_IMAGE_WIDTH = 640;

/** The item shape of GET /me/albums, reduced to the fields Shelf reads. */
export interface SpotifySavedAlbumItem {
  added_at: string;
  album: {
    id: string;
    uri: string;
    name: string;
    release_date: string;
    artists: { name: string }[];
    images: { url: string; width: number | null; height: number | null }[];
  };
}

export function convert_spotify_saved_album_item(spotify_saved_album_item: SpotifySavedAlbumItem): SavedAlbum {
  const spotify_album = spotify_saved_album_item.album;
  const release_year = Number.parseInt(spotify_album.release_date?.slice(0, 4) ?? "", 10);
  return {
    spotify_album_id: spotify_album.id,
    spotify_album_uri: spotify_album.uri,
    album_name: spotify_album.name,
    artist_names: spotify_album.artists.map((spotify_artist) => spotify_artist.name).join(", "),
    release_year: Number.isNaN(release_year) || release_year === 0 ? null : release_year,
    added_at: spotify_saved_album_item.added_at,
    cover_image_url: choose_cover_image_url(spotify_album.images),
    cover_dominant_colour: null,
  };
}

function choose_cover_image_url(spotify_images: SpotifySavedAlbumItem["album"]["images"]): string | null {
  if (spotify_images.length === 0) {
    return null;
  }
  const distance_from_preferred_width = (spotify_image: (typeof spotify_images)[number]) =>
    Math.abs((spotify_image.width ?? PREFERRED_COVER_IMAGE_WIDTH) - PREFERRED_COVER_IMAGE_WIDTH);
  return spotify_images.reduce((closest_image, spotify_image) =>
    distance_from_preferred_width(spotify_image) < distance_from_preferred_width(closest_image)
      ? spotify_image
      : closest_image,
  ).url;
}
