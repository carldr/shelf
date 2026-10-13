import { Texture } from "pixi.js";

/**
 * Covers are about 1200 px square on screen, and only a few are open at once. A 2000 px
 * cover would take 16 MB of GPU memory, so each one is scaled to its display size on
 * load, and the cache keeps a handful.
 */
const MAXIMUM_CACHED_COVER_TEXTURES = 16;

/**
 * Loads that may run at once. During a fast flick about one album a frame reaches the
 * middle; more parallel loads would only fetch and decode covers whose albums have left
 * the middle by the time the loads finish.
 */
const MAXIMUM_PARALLEL_COVER_LOADS = 2;

/**
 * A cover is wanted while its album was open in one of this many recent frames.
 * Loads for covers no longer wanted are not started, and their results are not uploaded.
 */
const COVER_WANTED_FRAME_COUNT = 2;

/** Produces a cover image `texture_size_px` square, or null when the album has no cover. */
export type ShelfCoverBitmapLoader = (texture_size_px: number) => Promise<ImageBitmap | null>;

/**
 * Loads cover textures on demand, scaled to `texture_size_px`, and keeps the most recently used ones.
 *
 * Uploading a 1200 px cover to the GPU takes about 10 ms, and during a fast flick a new album
 * reaches the middle every frame. So loads run newest first, two at a time; a load whose album
 * has closed is dropped before it starts and discarded when it finishes; and at most one
 * finished cover is uploaded per frame. A cover asked for at rest still starts loading at once.
 */
export class ShelfCoverTextureCache {
  /** Map order is use order: the first entry is the least recently used. */
  private readonly cover_textures_by_key = new Map<string, Texture>();
  private readonly waiting_loaders_by_key = new Map<string, ShelfCoverBitmapLoader>();
  private readonly running_load_keys = new Set<string>();
  private readonly finished_bitmaps_by_key = new Map<string, ImageBitmap>();
  private readonly last_wanted_frame_by_key = new Map<string, number>();
  private frame_number = 0;
  private texture_size_px = 640;

  constructor(private readonly create_texture: (cover_bitmap: ImageBitmap) => Texture = (cover_bitmap) => Texture.from(cover_bitmap)) {}

  /** Call once at the start of each frame, before any get_or_start_loading. */
  begin_frame(): void {
    this.frame_number += 1;
    this.upload_newest_wanted_finished_bitmap();
    this.discard_unwanted_finished_bitmaps();
  }

  /** Sets the size covers are scaled to, and drops textures made at another size. */
  set_texture_size_px(texture_size_px: number): void {
    if (texture_size_px === this.texture_size_px) {
      return;
    }
    this.texture_size_px = texture_size_px;
    this.destroy();
  }

  /** Returns the texture if uploaded; otherwise asks for it to be loaded and returns null. */
  get_or_start_loading(cover_key: string, load_cover_bitmap: ShelfCoverBitmapLoader): Texture | null {
    this.last_wanted_frame_by_key.set(cover_key, this.frame_number);
    const cover_texture = this.cover_textures_by_key.get(cover_key);
    if (cover_texture) {
      this.cover_textures_by_key.delete(cover_key);
      this.cover_textures_by_key.set(cover_key, cover_texture);
      return cover_texture;
    }
    if (!this.running_load_keys.has(cover_key) && !this.finished_bitmaps_by_key.has(cover_key)) {
      // Re-inserting moves the key to the end; the end holds the newest requests.
      this.waiting_loaders_by_key.delete(cover_key);
      this.waiting_loaders_by_key.set(cover_key, load_cover_bitmap);
      this.start_waiting_loads();
    }
    return null;
  }

  private is_cover_wanted(cover_key: string): boolean {
    const last_wanted_frame = this.last_wanted_frame_by_key.get(cover_key);
    return last_wanted_frame !== undefined && this.frame_number - last_wanted_frame < COVER_WANTED_FRAME_COUNT;
  }

  private start_waiting_loads(): void {
    while (this.running_load_keys.size < MAXIMUM_PARALLEL_COVER_LOADS && this.waiting_loaders_by_key.size > 0) {
      const waiting_entries = [...this.waiting_loaders_by_key];
      const [cover_key, load_cover_bitmap] = waiting_entries[waiting_entries.length - 1];
      this.waiting_loaders_by_key.delete(cover_key);
      if (this.is_cover_wanted(cover_key)) {
        void this.load_cover_bitmap(cover_key, load_cover_bitmap);
      }
    }
    for (const cover_key of this.waiting_loaders_by_key.keys()) {
      if (!this.is_cover_wanted(cover_key)) {
        this.waiting_loaders_by_key.delete(cover_key);
      }
    }
  }

  private async load_cover_bitmap(cover_key: string, load_cover_bitmap: ShelfCoverBitmapLoader): Promise<void> {
    const texture_size_px = this.texture_size_px;
    this.running_load_keys.add(cover_key);
    try {
      const cover_bitmap = await load_cover_bitmap(texture_size_px);
      if (cover_bitmap && texture_size_px === this.texture_size_px && this.is_cover_wanted(cover_key)) {
        this.finished_bitmaps_by_key.set(cover_key, cover_bitmap);
      } else {
        cover_bitmap?.close();
      }
    } catch (cover_error) {
      console.warn(`Shelf could not load the cover ${cover_key}`, cover_error);
    } finally {
      this.running_load_keys.delete(cover_key);
      this.start_waiting_loads();
    }
  }

  private upload_newest_wanted_finished_bitmap(): void {
    let newest_cover_key: string | null = null;
    for (const cover_key of this.finished_bitmaps_by_key.keys()) {
      if (
        this.is_cover_wanted(cover_key) &&
        (newest_cover_key === null ||
          this.last_wanted_frame_by_key.get(cover_key)! >= this.last_wanted_frame_by_key.get(newest_cover_key)!)
      ) {
        newest_cover_key = cover_key;
      }
    }
    if (newest_cover_key === null) {
      return;
    }
    const cover_bitmap = this.finished_bitmaps_by_key.get(newest_cover_key)!;
    this.finished_bitmaps_by_key.delete(newest_cover_key);
    this.cover_textures_by_key.set(newest_cover_key, this.create_texture(cover_bitmap));
    this.evict_least_recently_used_textures();
  }

  private discard_unwanted_finished_bitmaps(): void {
    for (const [cover_key, cover_bitmap] of this.finished_bitmaps_by_key) {
      if (!this.is_cover_wanted(cover_key)) {
        this.finished_bitmaps_by_key.delete(cover_key);
        cover_bitmap.close();
      }
    }
  }

  private evict_least_recently_used_textures(): void {
    for (const [cover_key, cover_texture] of this.cover_textures_by_key) {
      if (this.cover_textures_by_key.size <= MAXIMUM_CACHED_COVER_TEXTURES) {
        return;
      }
      this.cover_textures_by_key.delete(cover_key);
      cover_texture.destroy(true);
    }
  }

  destroy(): void {
    for (const cover_texture of this.cover_textures_by_key.values()) {
      cover_texture.destroy(true);
    }
    this.cover_textures_by_key.clear();
    for (const cover_bitmap of this.finished_bitmaps_by_key.values()) {
      cover_bitmap.close();
    }
    this.finished_bitmaps_by_key.clear();
    this.waiting_loaders_by_key.clear();
  }
}
