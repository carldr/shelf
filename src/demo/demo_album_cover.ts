import type { SavedAlbum } from "../library/saved_album";

const DEMO_COVER_FONT_FAMILY = "-apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif";

/** A stable number from a string, to seed each cover's shapes. */
function hash_text(text: string): number {
  let hash = 2166136261;
  for (let character_index = 0; character_index < text.length; character_index += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(character_index), 16777619);
  }
  return hash >>> 0;
}

/**
 * Draws a made-up cover for a demo album at `size_px` square: the album's colour, a few
 * seeded shapes, and the album and artist names in a corner, like a minimal sleeve design.
 */
export async function draw_demo_album_cover_bitmap(saved_album: SavedAlbum, size_px: number): Promise<ImageBitmap> {
  const cover_canvas = new OffscreenCanvas(size_px, size_px);
  const cover_context = cover_canvas.getContext("2d")!;
  let shape_seed = hash_text(saved_album.spotify_album_id);
  const next_fraction = () => {
    shape_seed = Math.imul(shape_seed ^ (shape_seed >>> 13), 1274126177) >>> 0;
    return shape_seed / 4294967296;
  };

  cover_context.fillStyle = saved_album.cover_dominant_colour ?? "#808080";
  cover_context.fillRect(0, 0, size_px, size_px);

  const shape_count = 2 + Math.floor(next_fraction() * 4);
  for (let shape_index = 0; shape_index < shape_count; shape_index += 1) {
    cover_context.globalAlpha = 0.15 + next_fraction() * 0.35;
    cover_context.fillStyle = next_fraction() < 0.5 ? "#ffffff" : "#000000";
    const shape_x = next_fraction() * size_px;
    const shape_y = next_fraction() * size_px;
    const shape_size = size_px * (0.15 + next_fraction() * 0.5);
    cover_context.beginPath();
    if (next_fraction() < 0.5) {
      cover_context.arc(shape_x, shape_y, shape_size / 2, 0, Math.PI * 2);
    } else {
      cover_context.rect(shape_x - shape_size / 2, shape_y - shape_size / 8, shape_size, shape_size / 4);
    }
    cover_context.fill();
  }
  cover_context.globalAlpha = 1;

  const text_margin = size_px * 0.06;
  cover_context.fillStyle = "rgba(255,255,255,0.92)";
  cover_context.textBaseline = "top";
  cover_context.font = `700 ${Math.round(size_px * 0.06)}px ${DEMO_COVER_FONT_FAMILY}`;
  cover_context.fillText(saved_album.album_name, text_margin, text_margin, size_px - 2 * text_margin);
  cover_context.font = `400 ${Math.round(size_px * 0.04)}px ${DEMO_COVER_FONT_FAMILY}`;
  cover_context.fillText(saved_album.artist_names, text_margin, text_margin + size_px * 0.08, size_px - 2 * text_margin);

  return cover_canvas.transferToImageBitmap();
}
