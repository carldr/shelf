import { describe, expect, it } from "vitest";
import { generate_demo_album_tracks } from "./demo_album_tracks";
import { generate_demo_saved_albums } from "./demo_saved_albums";

describe("generate_demo_album_tracks", () => {
  const demo_saved_albums = generate_demo_saved_albums();

  it("generates the same tracks for an album every time", () => {
    expect(generate_demo_album_tracks(demo_saved_albums[0])).toEqual(generate_demo_album_tracks(demo_saved_albums[0]));
  });

  it("generates 8 to 26 tracks, with short, full and scrolling lists across the library", () => {
    const track_counts = demo_saved_albums.map((saved_album) => generate_demo_album_tracks(saved_album).length);
    expect(Math.min(...track_counts)).toBeGreaterThanOrEqual(8);
    expect(Math.max(...track_counts)).toBeLessThanOrEqual(26);
    expect(track_counts.some((track_count) => track_count <= 15)).toBe(true);
    expect(track_counts.some((track_count) => track_count > 15 && track_count <= 18)).toBe(true);
    expect(track_counts.some((track_count) => track_count > 18)).toBe(true);
  });
});
