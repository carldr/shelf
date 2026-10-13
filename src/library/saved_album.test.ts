import { describe, expect, it } from "vitest";
import { convert_spotify_saved_album_item, type SavedAlbum, type SpotifySavedAlbumItem } from "./saved_album";
import { sort_saved_albums } from "./saved_album_sort_order";
import { fetch_all_saved_albums } from "./saved_albums_sync";

function create_spotify_saved_album_item(album_id: string, overrides: Partial<SpotifySavedAlbumItem["album"]> = {}) {
  return {
    added_at: "2024-01-01T00:00:00Z",
    album: {
      id: album_id,
      uri: `spotify:album:${album_id}`,
      name: `Album ${album_id}`,
      release_date: "1999-05-01",
      artists: [{ name: "Artist" }],
      images: [],
      ...overrides,
    },
  };
}

function create_saved_album(overrides: Partial<SavedAlbum>): SavedAlbum {
  return {
    spotify_album_id: "id",
    spotify_album_uri: "spotify:album:id",
    album_name: "Album",
    artist_names: "Artist",
    release_year: 2000,
    added_at: "2024-01-01T00:00:00Z",
    cover_image_url: null,
    cover_dominant_colour: null,
    ...overrides,
  };
}

describe("convert_spotify_saved_album_item", () => {
  it("joins artists, reads the year and picks the image closest to 640 px", () => {
    const saved_album = convert_spotify_saved_album_item(
      create_spotify_saved_album_item("a1", {
        artists: [{ name: "Daft Punk" }, { name: "Pharrell Williams" }],
        release_date: "2013",
        images: [
          { url: "https://i.scdn.co/640", width: 640, height: 640 },
          { url: "https://i.scdn.co/300", width: 300, height: 300 },
          { url: "https://i.scdn.co/64", width: 64, height: 64 },
        ],
      }),
    );
    expect(saved_album).toMatchObject({
      spotify_album_id: "a1",
      spotify_album_uri: "spotify:album:a1",
      artist_names: "Daft Punk, Pharrell Williams",
      release_year: 2013,
      cover_image_url: "https://i.scdn.co/640",
      cover_dominant_colour: null,
    });
  });

  it("gives a null year for Spotify's 0000 release date and a null cover for no images", () => {
    const saved_album = convert_spotify_saved_album_item(create_spotify_saved_album_item("a2", { release_date: "0000" }));
    expect(saved_album.release_year).toBeNull();
    expect(saved_album.cover_image_url).toBeNull();
  });
});

describe("fetch_all_saved_albums", () => {
  it("follows next links until the last page and reports progress", async () => {
    const pages: Record<string, { items: SpotifySavedAlbumItem[]; next: string | null; total: number }> = {
      "/me/albums?limit=10&offset=0": {
        items: [create_spotify_saved_album_item("a1"), create_spotify_saved_album_item("a2")],
        next: "https://api.spotify.com/v1/me/albums?offset=2&limit=10",
        total: 3,
      },
      "https://api.spotify.com/v1/me/albums?offset=2&limit=10": {
        items: [create_spotify_saved_album_item("a3")],
        next: null,
        total: 3,
      },
    };
    const progress_reports: [number, number][] = [];
    const saved_albums = await fetch_all_saved_albums(
      { get_json: async <ResponseBody>(url: string) => pages[url] as ResponseBody },
      (fetched_album_count, total_album_count) => progress_reports.push([fetched_album_count, total_album_count]),
    );
    expect(saved_albums.map((saved_album) => saved_album.spotify_album_id)).toEqual(["a1", "a2", "a3"]);
    expect(progress_reports).toEqual([
      [2, 3],
      [3, 3],
    ]);
  });
});

describe("sort_saved_albums", () => {
  const saved_albums = [
    create_saved_album({ spotify_album_id: "beatles", artist_names: "The Beatles", release_year: 1969, added_at: "2024-03-01T00:00:00Z" }),
    create_saved_album({ spotify_album_id: "abba", artist_names: "ABBA", release_year: 1976, added_at: "2024-01-01T00:00:00Z" }),
    create_saved_album({ spotify_album_id: "unknown_year", artist_names: "Cocteau Twins", release_year: null, added_at: "2024-02-01T00:00:00Z" }),
  ];
  const sorted_ids = (sort_order: Parameters<typeof sort_saved_albums>[1]) =>
    sort_saved_albums(saved_albums, sort_order).map((saved_album) => saved_album.spotify_album_id);

  it("puts the most recently added first", () => {
    expect(sorted_ids("recently_added")).toEqual(["beatles", "unknown_year", "abba"]);
  });

  it("files artists without a leading 'The'", () => {
    expect(sorted_ids("artist_a_to_z")).toEqual(["abba", "beatles", "unknown_year"]);
  });

  it("sorts album names A–Z without a leading 'The', then by artist", () => {
    const albums_by_name = [
      create_saved_album({ spotify_album_id: "the_bends", album_name: "The Bends", artist_names: "Radiohead" }),
      create_saved_album({ spotify_album_id: "abbey_road", album_name: "Abbey Road", artist_names: "The Beatles" }),
      create_saved_album({ spotify_album_id: "greatest_hits_queen", album_name: "Greatest Hits", artist_names: "Queen" }),
      create_saved_album({ spotify_album_id: "greatest_hits_abba", album_name: "Greatest Hits", artist_names: "ABBA" }),
    ];
    expect(sort_saved_albums(albums_by_name, "album_name_a_to_z").map((saved_album) => saved_album.spotify_album_id)).toEqual([
      "abbey_road",
      "the_bends",
      "greatest_hits_abba",
      "greatest_hits_queen",
    ]);
  });

  it("puts the oldest release first and unknown years last", () => {
    expect(sorted_ids("release_year")).toEqual(["beatles", "abba", "unknown_year"]);
  });
});
