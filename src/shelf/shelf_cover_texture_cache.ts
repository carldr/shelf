import { Texture } from "pixi.js";

/** About two screens' worth of open and recently open covers. */
const MAXIMUM_CACHED_COVER_TEXTURES = 48;

/**
 * Loads cover textures on demand and keeps the most recently used ones.
 * Only open albums show a cover, so a small cache holds everything a frame needs.
 */
export class ShelfCoverTextureCache {
  /** Map order is use order: the first entry is the least recently used. */
  private readonly cover_textures_by_url = new Map<string, Texture>();
  private readonly pending_cover_urls = new Set<string>();

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
    try {
      const cover_image = new Image();
      // The asset protocol is another origin; without CORS, WebGL refuses to upload the image.
      cover_image.crossOrigin = "anonymous";
      cover_image.src = cover_url;
      await cover_image.decode();
      this.cover_textures_by_url.set(cover_url, Texture.from(cover_image));
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
