import { describe, expect, it } from "vitest";
import { ShelfCoverTextureCache } from "./shelf_cover_texture_cache";

interface FakeBitmap {
  cover_key: string;
  closed: boolean;
  close(): void;
}

/** A cache whose loads finish only when the test resolves them, with fake bitmaps and textures. */
function create_test_cache() {
  const pending_load_resolvers = new Map<string, () => void>();
  const created_texture_keys: string[] = [];
  const closed_bitmap_keys: string[] = [];
  const cover_texture_cache = new ShelfCoverTextureCache((cover_bitmap) => {
    const fake_bitmap = cover_bitmap as unknown as FakeBitmap;
    created_texture_keys.push(fake_bitmap.cover_key);
    return { destroy: () => {} } as never;
  });
  const load_cover = (cover_key: string) => () =>
    new Promise<ImageBitmap>((resolve) => {
      pending_load_resolvers.set(cover_key, () =>
        resolve({
          cover_key,
          closed: false,
          close() {
            closed_bitmap_keys.push(cover_key);
          },
        } as unknown as ImageBitmap),
      );
    });
  const finish_load = async (cover_key: string) => {
    pending_load_resolvers.get(cover_key)!();
    pending_load_resolvers.delete(cover_key);
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  return { cover_texture_cache, load_cover, finish_load, pending_load_resolvers, created_texture_keys, closed_bitmap_keys };
}

describe("ShelfCoverTextureCache", () => {
  it("runs at most two loads at once", () => {
    const { cover_texture_cache, load_cover, pending_load_resolvers } = create_test_cache();
    cover_texture_cache.begin_frame();
    for (const cover_key of ["a", "b", "c"]) {
      cover_texture_cache.get_or_start_loading(cover_key, load_cover(cover_key));
    }
    expect([...pending_load_resolvers.keys()]).toEqual(["a", "b"]);
  });

  it("starts the newest waiting load first", async () => {
    const { cover_texture_cache, load_cover, finish_load, pending_load_resolvers } = create_test_cache();
    cover_texture_cache.begin_frame();
    for (const cover_key of ["a", "b", "c", "d"]) {
      cover_texture_cache.get_or_start_loading(cover_key, load_cover(cover_key));
    }
    await finish_load("a");
    expect([...pending_load_resolvers.keys()]).toEqual(["b", "d"]);
  });

  it("drops a waiting load whose album is no longer open", async () => {
    const { cover_texture_cache, load_cover, finish_load, pending_load_resolvers } = create_test_cache();
    cover_texture_cache.begin_frame();
    for (const cover_key of ["a", "b", "c"]) {
      cover_texture_cache.get_or_start_loading(cover_key, load_cover(cover_key));
    }
    cover_texture_cache.begin_frame();
    cover_texture_cache.begin_frame();
    await finish_load("a");
    // "c" was last asked for two frames ago, so it does not start.
    expect([...pending_load_resolvers.keys()]).toEqual(["b"]);
  });

  it("discards a finished load whose album is no longer open, without uploading it", async () => {
    const { cover_texture_cache, load_cover, finish_load, created_texture_keys, closed_bitmap_keys } = create_test_cache();
    cover_texture_cache.begin_frame();
    cover_texture_cache.get_or_start_loading("a", load_cover("a"));
    cover_texture_cache.begin_frame();
    cover_texture_cache.begin_frame();
    await finish_load("a");
    cover_texture_cache.begin_frame();
    expect(created_texture_keys).toEqual([]);
    expect(closed_bitmap_keys).toEqual(["a"]);
  });

  it("uploads at most one finished cover per frame", async () => {
    const { cover_texture_cache, load_cover, finish_load, created_texture_keys } = create_test_cache();
    cover_texture_cache.begin_frame();
    cover_texture_cache.get_or_start_loading("a", load_cover("a"));
    cover_texture_cache.get_or_start_loading("b", load_cover("b"));
    await finish_load("a");
    await finish_load("b");
    cover_texture_cache.begin_frame();
    cover_texture_cache.get_or_start_loading("a", load_cover("a"));
    cover_texture_cache.get_or_start_loading("b", load_cover("b"));
    expect(created_texture_keys).toHaveLength(1);
    cover_texture_cache.begin_frame();
    expect(created_texture_keys).toHaveLength(2);
  });

  it("returns the texture once uploaded", async () => {
    const { cover_texture_cache, load_cover, finish_load } = create_test_cache();
    cover_texture_cache.begin_frame();
    expect(cover_texture_cache.get_or_start_loading("a", load_cover("a"))).toBeNull();
    await finish_load("a");
    cover_texture_cache.begin_frame();
    expect(cover_texture_cache.get_or_start_loading("a", load_cover("a"))).not.toBeNull();
  });
});
