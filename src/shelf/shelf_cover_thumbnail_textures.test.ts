import { describe, expect, it } from "vitest";
import { ShelfCoverThumbnailTextures } from "./shelf_cover_thumbnail_textures";

const flush_promises = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("ShelfCoverThumbnailTextures", () => {
  it("loads each album's thumbnail once, in order, and returns its texture", async () => {
    const loaded_album_ids: string[] = [];
    const destroyed_texture_ids: string[] = [];
    const cover_thumbnail_textures = new ShelfCoverThumbnailTextures(
      async (spotify_album_id) => {
        loaded_album_ids.push(spotify_album_id);
        return { spotify_album_id } as unknown as ImageBitmap;
      },
      (thumbnail_bitmap) => {
        const { spotify_album_id } = thumbnail_bitmap as unknown as { spotify_album_id: string };
        return { spotify_album_id, destroy: () => destroyed_texture_ids.push(spotify_album_id) } as never;
      },
    );
    cover_thumbnail_textures.load_thumbnails(["a", "b", "a", "c"]);
    expect(cover_thumbnail_textures.get_thumbnail_texture("a")).toBeNull();
    await flush_promises();
    expect(loaded_album_ids).toEqual(["a", "b", "c"]);
    expect(cover_thumbnail_textures.get_thumbnail_texture("b")).toMatchObject({ spotify_album_id: "b" });

    cover_thumbnail_textures.load_thumbnails(["b", "d"]);
    await flush_promises();
    expect(loaded_album_ids).toEqual(["a", "b", "c", "d"]);
    expect(destroyed_texture_ids.sort()).toEqual(["a", "c"]);
  });
});
