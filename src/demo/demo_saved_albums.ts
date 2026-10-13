import type { SavedAlbum } from "../library/saved_album";

/**
 * Demo mode shows a generated library, so that the shelf works before any Spotify setup.
 * The names and covers are made up; nothing here reaches Spotify.
 */
export const DEMO_SAVED_ALBUM_COUNT = 240;
const DEMO_LIBRARY_SEED = 29;

const DEMO_ARTIST_FIRST_WORDS = [
  "The", "Velvet", "Paper", "Neon", "Silver", "Midnight", "Glass", "Northern", "Electric", "Quiet",
  "Golden", "Static", "Hollow", "Wild", "Lunar", "Copper", "Saint", "Distant", "Little", "Tidal",
];
const DEMO_ARTIST_SECOND_WORDS = [
  "Harbours", "Satellites", "Foxes", "Engines", "Lanterns", "Parades", "Orchards", "Signals", "Pilots",
  "Comets", "Ferries", "Gardens", "Arcades", "Rivers", "Choirs", "Machines", "Weather", "Kites",
];
const DEMO_ALBUM_NAME_WORDS = [
  "Afterglow", "Low Tide", "Night Bus", "Small Hours", "Overcast", "Long Division", "Paper Moon",
  "Northbound", "Slow Motion", "Static Bloom", "Open Water", "Last Light", "Second Summer",
  "Coastline", "Weekend Radio", "Glasshouse", "Fireworks", "Empty Rooms", "Halflife", "Tangerine",
  "Holloway", "Signal Fires", "Undertow", "Blue Hour", "Strangers", "Satellite Town", "Heatwave",
];

/** Mulberry32: a small seeded generator, so the demo library is the same on every run. */
function create_seeded_random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<Item>(items: readonly Item[], random: () => number): Item {
  return items[Math.floor(random() * items.length)];
}

function hsl_to_hex(hue: number, saturation: number, lightness: number): string {
  const amplitude = saturation * Math.min(lightness, 1 - lightness);
  const channel = (offset: number) => {
    const hue_sector = (offset + hue / 30) % 12;
    const value = lightness - amplitude * Math.max(-1, Math.min(hue_sector - 3, 9 - hue_sector, 1));
    return Math.round(value * 255)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

export function generate_demo_saved_albums(): SavedAlbum[] {
  const random = create_seeded_random(DEMO_LIBRARY_SEED);
  const newest_added_time_ms = Date.UTC(2026, 0, 1);
  return Array.from({ length: DEMO_SAVED_ALBUM_COUNT }, (_, album_index) => {
    const artist_names = `${pick(DEMO_ARTIST_FIRST_WORDS, random)} ${pick(DEMO_ARTIST_SECOND_WORDS, random)}`;
    const album_name = pick(DEMO_ALBUM_NAME_WORDS, random);
    const spotify_album_id = `demo${album_index.toString().padStart(4, "0")}`;
    return {
      spotify_album_id,
      spotify_album_uri: `spotify:album:${spotify_album_id}`,
      album_name,
      artist_names,
      release_year: 1965 + Math.floor(random() * 61),
      added_at: new Date(newest_added_time_ms - album_index * 3 * 24 * 60 * 60 * 1000).toISOString(),
      cover_image_url: null,
      cover_dominant_colour: hsl_to_hex(Math.floor(random() * 360), 0.35 + random() * 0.5, 0.2 + random() * 0.55),
    };
  });
}
