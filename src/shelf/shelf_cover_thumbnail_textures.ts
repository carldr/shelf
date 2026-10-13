import { Texture } from "pixi.js";

/** Thumbnails load in the background a few at a time, so start-up stays responsive. */
const PARALLEL_THUMBNAIL_LOADS = 4;

/** Produces an album's cover thumbnail, or null when it has none. */
export type ShelfCoverThumbnailLoader = (spotify_album_id: string) => Promise<ImageBitmap | null>;

/**
 * Holds a small cover texture for every album on the shelf, loaded once in the background.
 * An opening album shows its thumbnail from the first frame; no file is read while flicking.
 */
export class ShelfCoverThumbnailTextures {
  private readonly thumbnail_textures_by_album_id = new Map<string, Texture>();
  private waiting_album_ids: string[] = [];
  private running_load_count = 0;

  constructor(
    private readonly load_thumbnail_bitmap: ShelfCoverThumbnailLoader,
    private readonly create_texture: (thumbnail_bitmap: ImageBitmap) => Texture = (thumbnail_bitmap) =>
      Texture.from(thumbnail_bitmap),
  ) {}

  /**
   * Loads the thumbnails of `spotify_album_ids` that are not loaded yet, in the given order,
   * and destroys the thumbnails of albums no longer in the list.
   */
  load_thumbnails(spotify_album_ids: readonly string[]): void {
    const wanted_album_ids = new Set(spotify_album_ids);
    for (const [spotify_album_id, thumbnail_texture] of this.thumbnail_textures_by_album_id) {
      if (!wanted_album_ids.has(spotify_album_id)) {
        thumbnail_texture.destroy(true);
        this.thumbnail_textures_by_album_id.delete(spotify_album_id);
      }
    }
    this.waiting_album_ids = [...wanted_album_ids].filter(
      (spotify_album_id) => !this.thumbnail_textures_by_album_id.has(spotify_album_id),
    );
    this.start_waiting_loads();
  }

  get_thumbnail_texture(spotify_album_id: string): Texture | null {
    return this.thumbnail_textures_by_album_id.get(spotify_album_id) ?? null;
  }

  private start_waiting_loads(): void {
    while (this.running_load_count < PARALLEL_THUMBNAIL_LOADS && this.waiting_album_ids.length > 0) {
      void this.load_thumbnail_texture(this.waiting_album_ids.shift()!);
    }
  }

  private async load_thumbnail_texture(spotify_album_id: string): Promise<void> {
    this.running_load_count += 1;
    try {
      const thumbnail_bitmap = await this.load_thumbnail_bitmap(spotify_album_id);
      if (thumbnail_bitmap && !this.thumbnail_textures_by_album_id.has(spotify_album_id)) {
        this.thumbnail_textures_by_album_id.set(spotify_album_id, this.create_texture(thumbnail_bitmap));
      }
    } catch (thumbnail_error) {
      console.warn(`Shelf could not load the cover thumbnail of ${spotify_album_id}`, thumbnail_error);
    } finally {
      this.running_load_count -= 1;
      this.start_waiting_loads();
    }
  }

  destroy(): void {
    for (const thumbnail_texture of this.thumbnail_textures_by_album_id.values()) {
      thumbnail_texture.destroy(true);
    }
    this.thumbnail_textures_by_album_id.clear();
    this.waiting_album_ids = [];
  }
}
