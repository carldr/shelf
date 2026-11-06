import { describe, expect, it } from "vitest";
import { compute_album_back_track_row_layout } from "./album_back_track_list_layout";

describe("compute_album_back_track_row_layout", () => {
  it("gives up to 15 tracks the designed row height", () => {
    expect(compute_album_back_track_row_layout(15, 300).row_height).toBe(20);
    expect(compute_album_back_track_row_layout(9, 300).row_height).toBe(20);
  });

  it("shrinks the rows and type so that 16 to 18 tracks fit", () => {
    const squeezed_row_layout = compute_album_back_track_row_layout(18, 300);
    expect(squeezed_row_layout.row_height * 18).toBeCloseTo(300);
    expect(squeezed_row_layout.font_size).toBeLessThan(compute_album_back_track_row_layout(15, 300).font_size);
  });

  it("keeps the designed row height above 18 tracks, so the list scrolls", () => {
    expect(compute_album_back_track_row_layout(24, 300)).toEqual(compute_album_back_track_row_layout(15, 300));
  });
});
