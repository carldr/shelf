import { describe, expect, it } from "vitest";
import { derive_large_cover_image_url } from "./album_cover_cache";

describe("derive_large_cover_image_url", () => {
  it("swaps the 640 px size prefix for the 2000 px one", () => {
    expect(derive_large_cover_image_url("https://i.scdn.co/image/ab67616d0000b2737b8b951b63ed69a4b032c376")).toBe(
      "https://i.scdn.co/image/ab67616d000082c17b8b951b63ed69a4b032c376",
    );
  });

  it("returns null for a URL without the known prefix", () => {
    expect(derive_large_cover_image_url("https://mosaic.scdn.co/640/abc")).toBeNull();
  });
});
