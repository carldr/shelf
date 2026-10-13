import { describe, expect, it } from "vitest";
import {
  compute_album_rect_x,
  compute_closed_album_left_x,
  compute_shelf_content_width,
  ease_toward,
  find_closed_album_index_at,
  type ShelfGeometry,
} from "./shelf_layout";

// Extra width of a fully open album: 200 - 20 = 180. Content starts at 10 + 90 = 100.
const shelf_geometry: ShelfGeometry = { spine_width: 20, cover_size: 200, edge_padding: 10 };

describe("shelf layout", () => {
  it("leaves room at both ends for a cover to open", () => {
    expect(compute_closed_album_left_x(0, shelf_geometry)).toBe(100);
    expect(compute_shelf_content_width(3, shelf_geometry)).toBe(260);
  });

  it("finds the closed album under a point and clamps to the ends", () => {
    expect(find_closed_album_index_at(100, 5, shelf_geometry)).toBe(0);
    expect(find_closed_album_index_at(139, 5, shelf_geometry)).toBe(1);
    expect(find_closed_album_index_at(0, 5, shelf_geometry)).toBe(0);
    expect(find_closed_album_index_at(10_000, 5, shelf_geometry)).toBe(4);
  });

  it("opens an album centred on its spine and moves each side aside by half the extra width", () => {
    const opening_albums = [{ album_index: 2, open_amount: 1 }];
    // Album 2 closed: left 140, centre 150. Open: width 200, so left 50.
    expect(compute_album_rect_x(2, opening_albums, shelf_geometry)).toEqual({ left_x: 50, width: 200 });
    expect(compute_album_rect_x(1, opening_albums, shelf_geometry)).toEqual({ left_x: 30, width: 20 });
    expect(compute_album_rect_x(3, opening_albums, shelf_geometry)).toEqual({ left_x: 250, width: 20 });
  });

  it("keeps albums touching while two albums are part open", () => {
    const opening_albums = [
      { album_index: 2, open_amount: 0.25 },
      { album_index: 3, open_amount: 0.75 },
    ];
    const rects = [1, 2, 3, 4].map((album_index) => compute_album_rect_x(album_index, opening_albums, shelf_geometry));
    for (let rect_index = 1; rect_index < rects.length; rect_index += 1) {
      const previous_rect = rects[rect_index - 1];
      expect(rects[rect_index].left_x).toBeCloseTo(previous_rect.left_x + previous_rect.width);
    }
  });
});

describe("ease_toward", () => {
  it("covers 63 % of the distance in one time constant, in one step or many", () => {
    expect(ease_toward(0, 1, 100, 100)).toBeCloseTo(1 - Math.exp(-1));
    let value = 0;
    for (let frame = 0; frame < 10; frame += 1) value = ease_toward(value, 1, 10, 100);
    expect(value).toBeCloseTo(1 - Math.exp(-1));
  });
});
