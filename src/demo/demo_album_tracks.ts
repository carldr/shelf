import type { AlbumTrack } from "../library/album_tracks";
import type { SavedAlbum } from "../library/saved_album";
import { create_seeded_random, DEMO_ALBUM_NAME_WORDS, pick } from "./demo_saved_albums";

/** Demo albums have 8 to 26 tracks, so the back of the album shows a short list, a full list and a scrolling list. */
const DEMO_ALBUM_MINIMUM_TRACK_COUNT = 8;
const DEMO_ALBUM_MAXIMUM_TRACK_COUNT = 26;
const DEMO_TRACK_NAME_SUFFIXES = ["", "", "", "", " (Reprise)", " (Part II)", " (Demo)", " (Live)"];

/** Seeds the generator from the album ID, so each demo album lists the same tracks on every run. */
function hash_demo_album_id(spotify_album_id: string): number {
  let hash = 2166136261;
  for (const character of spotify_album_id) {
    hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  }
  return hash >>> 0;
}

/** A made-up track list for a demo album. The tracks do not exist on Spotify. */
export function generate_demo_album_tracks(saved_album: SavedAlbum): AlbumTrack[] {
  const random = create_seeded_random(hash_demo_album_id(saved_album.spotify_album_id));
  const track_count =
    DEMO_ALBUM_MINIMUM_TRACK_COUNT +
    Math.floor(random() * (DEMO_ALBUM_MAXIMUM_TRACK_COUNT - DEMO_ALBUM_MINIMUM_TRACK_COUNT + 1));
  return Array.from({ length: track_count }, (_, track_index) => {
    const spotify_track_id = `${saved_album.spotify_album_id}track${String(track_index + 1).padStart(2, "0")}`;
    return {
      spotify_track_id,
      spotify_track_uri: `spotify:track:${spotify_track_id}`,
      track_name: `${pick(DEMO_ALBUM_NAME_WORDS, random)}${pick(DEMO_TRACK_NAME_SUFFIXES, random)}`,
      duration_ms: Math.round((120 + random() * 300) * 1000),
    };
  });
}
