/** The back of the album is laid out for this many tracks. */
export const ALBUM_BACK_DESIGNED_TRACK_COUNT = 15;
/** Up to this many tracks, the rows get shorter so that every track fits without scrolling. */
export const ALBUM_BACK_MAXIMUM_SQUEEZED_TRACK_COUNT = 18;
export interface AlbumBackTrackRowLayout {
  row_height: number;
  /** 1 at the designed row height. Squeezed rows shrink their type by the same share. */
  type_scale: number;
}

/**
 * The row height and type scale of the track list on the back of the album.
 * Up to 15 tracks, the rows take the designed height. From 16 to 18 tracks, the rows and type shrink to fit.
 * Above 18 tracks, the rows keep the designed height and the list scrolls.
 */
export function compute_album_back_track_row_layout(
  track_count: number,
  track_list_height: number,
): AlbumBackTrackRowLayout {
  const designed_row_height = track_list_height / ALBUM_BACK_DESIGNED_TRACK_COUNT;
  if (track_count <= ALBUM_BACK_DESIGNED_TRACK_COUNT || track_count > ALBUM_BACK_MAXIMUM_SQUEEZED_TRACK_COUNT) {
    return { row_height: designed_row_height, type_scale: 1 };
  }
  const squeezed_row_height = track_list_height / track_count;
  return { row_height: squeezed_row_height, type_scale: squeezed_row_height / designed_row_height };
}
