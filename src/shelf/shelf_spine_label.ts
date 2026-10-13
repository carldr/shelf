const LIGHT_LABEL_COLOUR = 0xffffff;
const DARK_LABEL_COLOUR = 0x111111;
const ELLIPSIS = "…";

export function parse_hex_colour(hex_colour: string): number {
  return Number.parseInt(hex_colour.slice(1), 16);
}

/** WCAG 2 relative luminance of a 0xrrggbb colour. */
function compute_relative_luminance(rgb_colour: number): number {
  const to_linear_channel = (channel_byte: number) => {
    const channel = channel_byte / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  };
  return (
    0.2126 * to_linear_channel((rgb_colour >> 16) & 0xff) +
    0.7152 * to_linear_channel((rgb_colour >> 8) & 0xff) +
    0.0722 * to_linear_channel(rgb_colour & 0xff)
  );
}

function compute_contrast_ratio(first_luminance: number, second_luminance: number): number {
  return (Math.max(first_luminance, second_luminance) + 0.05) / (Math.min(first_luminance, second_luminance) + 0.05);
}

/** White or near-black, whichever has the higher contrast ratio against the spine colour. */
export function choose_spine_label_colour(spine_colour: number): number {
  const spine_luminance = compute_relative_luminance(spine_colour);
  const light_contrast = compute_contrast_ratio(spine_luminance, compute_relative_luminance(LIGHT_LABEL_COLOUR));
  const dark_contrast = compute_contrast_ratio(spine_luminance, compute_relative_luminance(DARK_LABEL_COLOUR));
  return light_contrast >= dark_contrast ? LIGHT_LABEL_COLOUR : DARK_LABEL_COLOUR;
}

/** Shortens `text` with an ellipsis until `measure_text_width` fits `maximum_width`. */
export function truncate_text_to_width(
  text: string,
  maximum_width: number,
  measure_text_width: (text: string) => number,
): string {
  if (measure_text_width(text) <= maximum_width) {
    return text;
  }
  let shortest_length = 0;
  let longest_length = text.length;
  // Binary search for the longest prefix that fits with the ellipsis.
  while (shortest_length < longest_length) {
    const middle_length = Math.ceil((shortest_length + longest_length) / 2);
    if (measure_text_width(text.slice(0, middle_length).trimEnd() + ELLIPSIS) <= maximum_width) {
      shortest_length = middle_length;
    } else {
      longest_length = middle_length - 1;
    }
  }
  return shortest_length === 0 ? "" : text.slice(0, shortest_length).trimEnd() + ELLIPSIS;
}

/**
 * Fits the artist and album name along one spine, separated by `gap_width`.
 * The album name gives way first; the artist keeps at least `minimum_artist_share` of the length.
 */
export function fit_spine_label_texts(
  spine_label_input: { artist_names: string; album_name: string },
  available_length: number,
  gap_width: number,
  measure_artist_width: (text: string) => number,
  measure_album_name_width: (text: string) => number,
  minimum_artist_share = 0.45,
): { artist_text: string; album_name_text: string } {
  const full_artist_width = measure_artist_width(spine_label_input.artist_names);
  const artist_length_limit = Math.max(
    available_length * minimum_artist_share,
    available_length - gap_width - measure_album_name_width(spine_label_input.album_name),
  );
  const artist_text = truncate_text_to_width(
    spine_label_input.artist_names,
    Math.min(full_artist_width, artist_length_limit),
    measure_artist_width,
  );
  const album_name_length = available_length - measure_artist_width(artist_text) - gap_width;
  return {
    artist_text,
    album_name_text: truncate_text_to_width(spine_label_input.album_name, album_name_length, measure_album_name_width),
  };
}
