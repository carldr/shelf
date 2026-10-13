/** Covers are scaled to this many pixels square before sampling. */
const DOMINANT_COLOUR_SAMPLE_SIZE = 32;

/** Bits kept per channel when pixels are grouped into colour buckets. */
const COLOUR_BUCKET_BITS_PER_CHANNEL = 4;

/**
 * Returns the cover's dominant colour as "#rrggbb".
 *
 * Pixels are grouped into colour buckets. Each pixel counts more the more saturated it is,
 * so that a vivid colour wins over a larger area of grey; the result is the mean colour of
 * the heaviest bucket. `rgba_pixels` is ImageData.data: four bytes per pixel.
 */
export function compute_dominant_colour_from_rgba_pixels(rgba_pixels: Uint8ClampedArray): string {
  const bucket_shift = 8 - COLOUR_BUCKET_BITS_PER_CHANNEL;
  const colour_buckets = new Map<number, { weight: number; red_sum: number; green_sum: number; blue_sum: number }>();

  for (let pixel_offset = 0; pixel_offset < rgba_pixels.length; pixel_offset += 4) {
    const red = rgba_pixels[pixel_offset];
    const green = rgba_pixels[pixel_offset + 1];
    const blue = rgba_pixels[pixel_offset + 2];
    const alpha = rgba_pixels[pixel_offset + 3];
    if (alpha < 128) {
      continue;
    }
    const channel_maximum = Math.max(red, green, blue);
    const channel_minimum = Math.min(red, green, blue);
    const saturation = channel_maximum === 0 ? 0 : (channel_maximum - channel_minimum) / channel_maximum;
    const pixel_weight = 1 + saturation * 3;

    const bucket_key =
      ((red >> bucket_shift) << (2 * COLOUR_BUCKET_BITS_PER_CHANNEL)) |
      ((green >> bucket_shift) << COLOUR_BUCKET_BITS_PER_CHANNEL) |
      (blue >> bucket_shift);
    const colour_bucket = colour_buckets.get(bucket_key) ?? { weight: 0, red_sum: 0, green_sum: 0, blue_sum: 0 };
    colour_bucket.weight += pixel_weight;
    colour_bucket.red_sum += red * pixel_weight;
    colour_bucket.green_sum += green * pixel_weight;
    colour_bucket.blue_sum += blue * pixel_weight;
    colour_buckets.set(bucket_key, colour_bucket);
  }

  let heaviest_bucket = { weight: 1, red_sum: 128, green_sum: 128, blue_sum: 128 };
  for (const colour_bucket of colour_buckets.values()) {
    if (colour_bucket.weight > heaviest_bucket.weight) {
      heaviest_bucket = colour_bucket;
    }
  }
  const to_hex_channel = (channel_sum: number) =>
    Math.round(channel_sum / heaviest_bucket.weight)
      .toString(16)
      .padStart(2, "0");
  return `#${to_hex_channel(heaviest_bucket.red_sum)}${to_hex_channel(heaviest_bucket.green_sum)}${to_hex_channel(heaviest_bucket.blue_sum)}`;
}

/** Decodes a cover image and returns its dominant colour as "#rrggbb". */
export async function compute_dominant_colour_from_image_blob(cover_image_blob: Blob): Promise<string> {
  const cover_bitmap = await createImageBitmap(cover_image_blob, {
    resizeWidth: DOMINANT_COLOUR_SAMPLE_SIZE,
    resizeHeight: DOMINANT_COLOUR_SAMPLE_SIZE,
    resizeQuality: "medium",
  });
  const sample_canvas = new OffscreenCanvas(DOMINANT_COLOUR_SAMPLE_SIZE, DOMINANT_COLOUR_SAMPLE_SIZE);
  const sample_context = sample_canvas.getContext("2d")!;
  sample_context.drawImage(cover_bitmap, 0, 0);
  cover_bitmap.close();
  return compute_dominant_colour_from_rgba_pixels(
    sample_context.getImageData(0, 0, DOMINANT_COLOUR_SAMPLE_SIZE, DOMINANT_COLOUR_SAMPLE_SIZE).data,
  );
}
