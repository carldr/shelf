/**
 * Pure geometry of the shelf, in content coordinates (before scrolling).
 *
 * Closed albums stand side by side as spines. An opening album grows from spine width to
 * cover width, centred on its own closed spine, so the albums on each side move aside by
 * half of its extra width. The open album is the one whose closed spine is in the middle
 * of the view. Closed positions do not move while albums open, so focus does not jitter.
 */

export interface ShelfGeometry {
  spine_width: number;
  /** The open cover is square; its side is also the spine height. */
  cover_size: number;
  /** Space before the first album and after the last one, beyond the room an open cover needs. */
  edge_padding: number;
}

/** An album whose open amount is above zero: 0 is a closed spine, 1 is a fully open cover. */
export interface OpeningAlbum {
  album_index: number;
  open_amount: number;
}

export function compute_open_extra_width(open_amount: number, shelf_geometry: ShelfGeometry): number {
  return open_amount * (shelf_geometry.cover_size - shelf_geometry.spine_width);
}

/** The space at each end, so that the first and last albums can open without being cut off. */
function compute_content_start_x(shelf_geometry: ShelfGeometry): number {
  return shelf_geometry.edge_padding + (shelf_geometry.cover_size - shelf_geometry.spine_width) / 2;
}

export function compute_closed_album_left_x(album_index: number, shelf_geometry: ShelfGeometry): number {
  return compute_content_start_x(shelf_geometry) + album_index * shelf_geometry.spine_width;
}

/** The album whose closed spine contains `content_x`, clamped to the first and last album. */
export function find_closed_album_index_at(
  content_x: number,
  album_count: number,
  shelf_geometry: ShelfGeometry,
): number {
  const album_index = Math.floor((content_x - compute_content_start_x(shelf_geometry)) / shelf_geometry.spine_width);
  return Math.min(Math.max(album_index, 0), album_count - 1);
}

/** The left edge and width of an album after the opening albums have pushed their neighbours aside. */
export function compute_album_rect_x(
  album_index: number,
  opening_albums: readonly OpeningAlbum[],
  shelf_geometry: ShelfGeometry,
): { left_x: number; width: number } {
  let shift_x = 0;
  let own_open_amount = 0;
  for (const opening_album of opening_albums) {
    const half_extra_width = compute_open_extra_width(opening_album.open_amount, shelf_geometry) / 2;
    if (opening_album.album_index < album_index) {
      shift_x += half_extra_width;
    } else if (opening_album.album_index > album_index) {
      shift_x -= half_extra_width;
    } else {
      shift_x -= half_extra_width;
      own_open_amount = opening_album.open_amount;
    }
  }
  return {
    left_x: compute_closed_album_left_x(album_index, shelf_geometry) + shift_x,
    width: shelf_geometry.spine_width + compute_open_extra_width(own_open_amount, shelf_geometry),
  };
}

/** The scroll position that puts the album's closed spine centre in the middle of the view. */
export function compute_scroll_x_centring_album(
  album_index: number,
  view_width: number,
  shelf_geometry: ShelfGeometry,
): number {
  return compute_closed_album_left_x(album_index, shelf_geometry) + shelf_geometry.spine_width / 2 - view_width / 2;
}

/** Scrolling stops when the first or the last album is in the middle of the view. */
export function compute_scroll_x_range(
  album_count: number,
  view_width: number,
  shelf_geometry: ShelfGeometry,
): { minimum_scroll_x: number; maximum_scroll_x: number } {
  return {
    minimum_scroll_x: compute_scroll_x_centring_album(0, view_width, shelf_geometry),
    maximum_scroll_x: compute_scroll_x_centring_album(Math.max(album_count - 1, 0), view_width, shelf_geometry),
  };
}

/** The album drawn at `content_x` among albums `first_album_index`…`last_album_index`, or -1 for none. */
export function find_drawn_album_index_at(
  content_x: number,
  first_album_index: number,
  last_album_index: number,
  opening_albums: readonly OpeningAlbum[],
  shelf_geometry: ShelfGeometry,
): number {
  for (let album_index = first_album_index; album_index <= last_album_index; album_index += 1) {
    const album_rect = compute_album_rect_x(album_index, opening_albums, shelf_geometry);
    if (content_x >= album_rect.left_x && content_x < album_rect.left_x + album_rect.width) {
      return album_index;
    }
  }
  return -1;
}

/**
 * Moves `current_value` toward `target_value` by exponential smoothing.
 * `time_constant_ms` is the time to cover 63 % of the remaining distance, at any frame rate.
 */
export function ease_toward(
  current_value: number,
  target_value: number,
  elapsed_ms: number,
  time_constant_ms: number,
): number {
  return target_value + (current_value - target_value) * Math.exp(-elapsed_ms / time_constant_ms);
}
