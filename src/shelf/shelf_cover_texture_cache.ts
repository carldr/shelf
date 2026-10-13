import { Texture } from "pixi.js";

/**
 * Covers are about 870 px square on screen, and only a few are open at once. A 2000 px
 * cover would take 16 MB of GPU memory, so each one is scaled to its display size on
 * load, and the cache keeps a handful.
 */
const MAXIMUM_CACHED_COVER_TEXTURES = 16;

/**
 * Loads cover textures on demand, scaled to `texture_size_px`, and keeps the most recently used ones.
 * Only open albums show a cover, so a small cache holds everything a frame needs.
 */
export class ShelfCoverTextureCache {
  /** Map order is use order: the first entry is the least recently used. */
  private readonly cover_textures_by_url = new Map<string, Texture>();
  private readonly pending_cover_urls = new Set<string>();
  private texture_size_px = 640;

  /** Sets the size covers are scaled to, and drops textures made at another size. */
  set_texture_size_px(texture_size_px: number): void {
    if (texture_size_px === this.texture_size_px) {
      return;
    }
    this.texture_size_px = texture_size_px;
    this.destroy();
  }

  /** Returns the texture if loaded; otherwise starts loading it and returns null. */
  get_or_start_loading(cover_url: string): Texture | null {
    const cover_texture = this.cover_textures_by_url.get(cover_url);
    if (cover_texture) {
      this.cover_textures_by_url.delete(cover_url);
      this.cover_textures_by_url.set(cover_url, cover_texture);
      return cover_texture;
    }
    if (!this.pending_cover_urls.has(cover_url)) {
      this.pending_cover_urls.add(cover_url);
      void this.load_cover_texture(cover_url);
    }
    return null;
  }

  private async load_cover_texture(cover_url: string): Promise<void> {
    const texture_size_px = this.texture_size_px;
    try {
      const cover_response = await fetch(cover_url);
      if (!cover_response.ok) {
        throw new Error(`Cover file request failed (${cover_response.status})`);
      }
      // createImageBitmap decodes and scales off the main thread, so scrolling does not stall.
      const cover_bitmap = await createImageBitmap(await cover_response.blob(), {
        resizeWidth: texture_size_px,
        resizeHeight: texture_size_px,
        resizeQuality: "high",
      });
      if (texture_size_px !== this.texture_size_px) {
        cover_bitmap.close();
        return;
      }
      this.cover_textures_by_url.set(cover_url, Texture.from(cover_bitmap));
      this.evict_least_recently_used_textures();
    } catch (cover_error) {
      console.warn(`Shelf could not load the cover ${cover_url}`, cover_error);
    } finally {
      this.pending_cover_urls.delete(cover_url);
    }
  }

  private evict_least_recently_used_textures(): void {
    for (const [cover_url, cover_texture] of this.cover_textures_by_url) {
      if (this.cover_textures_by_url.size <= MAXIMUM_CACHED_COVER_TEXTURES) {
        return;
      }
      this.cover_textures_by_url.delete(cover_url);
      cover_texture.destroy(true);
    }
  }

  destroy(): void {
    for (const cover_texture of this.cover_textures_by_url.values()) {
      cover_texture.destroy(true);
    }
    this.cover_textures_by_url.clear();
  }
}
