import { Texture } from "pixi.js";

/**
 * Covers are about 1200 px square on screen, and only a few are open at once. A 2000 px
 * cover would take 16 MB of GPU memory, so each one is scaled to its display size on
 * load, and the cache keeps a handful.
 */
const MAXIMUM_CACHED_COVER_TEXTURES = 16;

/** Produces a cover image `texture_size_px` square, or null when the album has no cover. */
export type ShelfCoverBitmapLoader = (texture_size_px: number) => Promise<ImageBitmap | null>;

/**
 * Loads cover textures on demand, scaled to `texture_size_px`, and keeps the most recently used ones.
 * Only open albums show a cover, so a small cache holds everything a frame needs.
 */
export class ShelfCoverTextureCache {
  /** Map order is use order: the first entry is the least recently used. */
  private readonly cover_textures_by_key = new Map<string, Texture>();
  private readonly pending_cover_keys = new Set<string>();
  private texture_size_px = 640;

  /** Sets the size covers are scaled to, and drops textures made at another size. */
  set_texture_size_px(texture_size_px: number): void {
    if (texture_size_px === this.texture_size_px) {
      return;
    }
    this.texture_size_px = texture_size_px;
    this.destroy();
  }

  /** Returns the texture if loaded, without starting a load. */
  get_loaded(cover_key: string): Texture | null {
    return this.cover_textures_by_key.get(cover_key) ?? null;
  }

  /** Returns the texture if loaded; otherwise starts `load_cover_bitmap` and returns null. */
  get_or_start_loading(cover_key: string, load_cover_bitmap: ShelfCoverBitmapLoader): Texture | null {
    const cover_texture = this.cover_textures_by_key.get(cover_key);
    if (cover_texture) {
      this.cover_textures_by_key.delete(cover_key);
      this.cover_textures_by_key.set(cover_key, cover_texture);
      return cover_texture;
    }
    if (!this.pending_cover_keys.has(cover_key)) {
      this.pending_cover_keys.add(cover_key);
      void this.load_cover_texture(cover_key, load_cover_bitmap);
    }
    return null;
  }

  private async load_cover_texture(cover_key: string, load_cover_bitmap: ShelfCoverBitmapLoader): Promise<void> {
    const texture_size_px = this.texture_size_px;
    try {
      const cover_bitmap = await load_cover_bitmap(texture_size_px);
      if (!cover_bitmap) {
        return;
      }
      if (texture_size_px !== this.texture_size_px) {
        cover_bitmap.close();
        return;
      }
      this.cover_textures_by_key.set(cover_key, Texture.from(cover_bitmap));
      this.evict_least_recently_used_textures();
    } catch (cover_error) {
      console.warn(`Shelf could not load the cover ${cover_key}`, cover_error);
    } finally {
      this.pending_cover_keys.delete(cover_key);
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
  }
}
