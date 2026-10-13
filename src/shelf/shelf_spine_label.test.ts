import { describe, expect, it } from "vitest";
import { choose_spine_label_colour, fit_spine_label_texts, truncate_text_to_width } from "./shelf_spine_label";

// One unit per character keeps the expected values readable.
const measure_by_character_count = (text: string) => text.length;

describe("choose_spine_label_colour", () => {
  it("puts dark text on yellow and white text on dark blue", () => {
    expect(choose_spine_label_colour(0xfed322)).toBe(0x111111);
    expect(choose_spine_label_colour(0x1a237e)).toBe(0xffffff);
  });
});

describe("truncate_text_to_width", () => {
  it("leaves text that fits", () => {
    expect(truncate_text_to_width("Pulp", 4, measure_by_character_count)).toBe("Pulp");
  });

  it("cuts to the longest prefix that fits with the ellipsis", () => {
    expect(truncate_text_to_width("Different Class", 8, measure_by_character_count)).toBe("Differe…");
  });

  it("drops a trailing space before the ellipsis", () => {
    expect(truncate_text_to_width("His n Hers", 5, measure_by_character_count)).toBe("His…");
  });
});

describe("fit_spine_label_texts", () => {
  it("keeps both in full when they fit", () => {
    expect(
      fit_spine_label_texts({ artist_names: "Pulp", album_name: "More" }, 20, 2, measure_by_character_count, measure_by_character_count),
    ).toEqual({ artist_text: "Pulp", album_name_text: "More" });
  });

  it("shortens the album name before the artist", () => {
    expect(
      fit_spine_label_texts(
        { artist_names: "James", album_name: "Laid / Wah Wah" },
        14,
        2,
        measure_by_character_count,
        measure_by_character_count,
      ),
    ).toEqual({ artist_text: "James", album_name_text: "Laid /…" });
  });

  it("keeps a share of the length for the artist when both are long", () => {
    const fitted_texts = fit_spine_label_texts(
      { artist_names: "Godspeed You! Black Emperor", album_name: "Lift Your Skinny Fists Like Antennas to Heaven" },
      20,
      2,
      measure_by_character_count,
      measure_by_character_count,
    );
    expect(fitted_texts.artist_text).toBe("Godspeed…");
    expect(fitted_texts.album_name_text.length).toBeLessThanOrEqual(20 - 2 - 9);
  });
});
