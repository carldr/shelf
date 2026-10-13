import { describe, expect, it } from "vitest";
import { DEMO_SAVED_ALBUM_COUNT, generate_demo_saved_albums } from "./demo_saved_albums";

describe("generate_demo_saved_albums", () => {
  it("generates the same library every time", () => {
    expect(generate_demo_saved_albums()).toEqual(generate_demo_saved_albums());
  });

  it("generates complete albums with unique IDs and colours", () => {
    const demo_saved_albums = generate_demo_saved_albums();
    expect(demo_saved_albums).toHaveLength(DEMO_SAVED_ALBUM_COUNT);
    expect(new Set(demo_saved_albums.map((saved_album) => saved_album.spotify_album_id)).size).toBe(
      DEMO_SAVED_ALBUM_COUNT,
    );
    for (const saved_album of demo_saved_albums) {
      expect(saved_album.cover_dominant_colour).toMatch(/^#[0-9a-f]{6}$/);
      expect(saved_album.release_year).toBeGreaterThanOrEqual(1965);
      expect(saved_album.artist_names.length).toBeGreaterThan(0);
      expect(saved_album.album_name.length).toBeGreaterThan(0);
    }
  });
});
