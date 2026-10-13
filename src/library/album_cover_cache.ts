import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { appDataDir, join } from "@tauri-apps/api/path";
import { BaseDirectory, exists, mkdir, readDir, remove, rename, writeFile } from "@tauri-apps/plugin-fs";
import type { SavedAlbum } from "./saved_album";

const ALBUM_COVERS_DIRECTORY_NAME = "covers";
const PARALLEL_COVER_DOWNLOADS = 6;

/**
 * The Web API lists covers up to 640 px. The image CDN also serves 2000 px when the
 * 640 px size prefix in the URL is swapped. This is undocumented, so a failed large
 * download falls back to the listed 640 px image.
 */
const COVER_IMAGE_640_PX_PREFIX = "/image/ab67616d0000b273";
const COVER_IMAGE_2000_PX_PREFIX = "/image/ab67616d000082c1";

/** The 2000 px URL for a 640 px cover URL, or null when the URL has another form. */
export function derive_large_cover_image_url(cover_image_url: string): string | null {
  return cover_image_url.includes(COVER_IMAGE_640_PX_PREFIX)
    ? cover_image_url.replace(COVER_IMAGE_640_PX_PREFIX, COVER_IMAGE_2000_PX_PREFIX)
    : null;
}

/**
 * Names the cached file after the image ID at the end of the cover URL, such as
 * https://i.scdn.co/image/ab67616d0000b273… When Spotify or Shelf changes the image,
 * the URL changes, so the new image is downloaded and the old file is deleted as unused.
 * The "_large" suffix marks files downloaded at 2000 px where the CDN had that size.
 */
function album_cover_file_name(cover_image_url: string): string {
  return `${cover_image_url.slice(cover_image_url.lastIndexOf("/") + 1)}_large.jpg`;
}

/**
 * The shelf shows this small copy of a cover the moment an album starts to open, and swaps in
 * the full cover once the album has stayed in the middle. Loading a full cover for every album
 * that passes the middle during a flick cannot keep up with 60 frames per second.
 */
export const ALBUM_COVER_THUMBNAIL_SIZE_PX = 256;

function album_cover_thumbnail_file_name(cover_image_url: string): string {
  return `${cover_image_url.slice(cover_image_url.lastIndexOf("/") + 1)}_thumbnail_${ALBUM_COVER_THUMBNAIL_SIZE_PX}.jpg`;
}

function album_cover_relative_path(cover_file_name: string): string {
  return `${ALBUM_COVERS_DIRECTORY_NAME}/${cover_file_name}`;
}

let album_covers_directory_path: string | null = null;

/** Resolves the covers directory once; call before load_cached_album_cover_bitmap. */
export async function resolve_album_covers_directory_path(): Promise<void> {
  album_covers_directory_path = await join(await appDataDir(), ALBUM_COVERS_DIRECTORY_NAME);
}

/**
 * Reads a file from the covers directory over the asset protocol and decodes it, scaled to
 * `size_px` square when given. createImageBitmap decodes off the main thread.
 */
async function load_cover_file_bitmap(cover_file_name: string, size_px?: number): Promise<ImageBitmap> {
  if (!album_covers_directory_path) {
    throw new Error("resolve_album_covers_directory_path has not run.");
  }
  const cover_response = await fetch(convertFileSrc(`${album_covers_directory_path}/${cover_file_name}`));
  if (!cover_response.ok) {
    throw new Error(`Cover file request failed (${cover_response.status})`);
  }
  const cover_blob = await cover_response.blob();
  return size_px
    ? createImageBitmap(cover_blob, { resizeWidth: size_px, resizeHeight: size_px, resizeQuality: "high" })
    : createImageBitmap(cover_blob);
}

/** Reads the album's cached full cover, scaled to `size_px` square. Null when the album has no cover. */
export async function load_cached_album_cover_bitmap(saved_album: SavedAlbum, size_px: number): Promise<ImageBitmap | null> {
  return saved_album.cover_image_url
    ? load_cover_file_bitmap(album_cover_file_name(saved_album.cover_image_url), size_px)
    : null;
}

/** Reads the album's cached thumbnail. Null when the album has no cover. */
export async function load_cached_album_cover_thumbnail_bitmap(saved_album: SavedAlbum): Promise<ImageBitmap | null> {
  return saved_album.cover_image_url
    ? load_cover_file_bitmap(album_cover_thumbnail_file_name(saved_album.cover_image_url))
    : null;
}

/**
 * Downloads each album's cover once into the covers directory, writes its thumbnail, and samples
 * its dominant colour. Covers already on disk are not downloaded again. Files that no saved album
 * uses are deleted. Returns the albums with `cover_dominant_colour` filled in where a cover exists.
 */
export async function cache_album_covers(
  saved_albums: readonly SavedAlbum[],
  on_progress: (cached_cover_count: number, total_cover_count: number) => void = () => {},
): Promise<SavedAlbum[]> {
  await mkdir(ALBUM_COVERS_DIRECTORY_NAME, { baseDir: BaseDirectory.AppData, recursive: true });
  await delete_unused_cover_files(saved_albums);

  const albums_with_colours = [...saved_albums];
  let next_album_index = 0;
  let cached_cover_count = 0;

  const cache_next_covers = async () => {
    while (next_album_index < albums_with_colours.length) {
      const album_index = next_album_index++;
      const saved_album = albums_with_colours[album_index];
      try {
        albums_with_colours[album_index] = await cache_album_cover(saved_album);
      } catch (cover_error) {
        console.warn(`Shelf could not cache the cover of ${saved_album.spotify_album_id}`, cover_error);
      }
      on_progress(++cached_cover_count, albums_with_colours.length);
    }
  };
  await Promise.all(Array.from({ length: PARALLEL_COVER_DOWNLOADS }, cache_next_covers));
  return albums_with_colours;
}

async function cache_album_cover(saved_album: SavedAlbum): Promise<SavedAlbum> {
  if (!saved_album.cover_image_url) {
    return saved_album;
  }
  const cover_relative_path = album_cover_relative_path(album_cover_file_name(saved_album.cover_image_url));
  const thumbnail_relative_path = album_cover_relative_path(
    album_cover_thumbnail_file_name(saved_album.cover_image_url),
  );
  const cover_is_cached = await exists(cover_relative_path, { baseDir: BaseDirectory.AppData });
  const thumbnail_is_cached = await exists(thumbnail_relative_path, { baseDir: BaseDirectory.AppData });
  if (cover_is_cached && thumbnail_is_cached && saved_album.cover_dominant_colour) {
    return saved_album;
  }

  if (!cover_is_cached) {
    const cover_image_bytes = await download_largest_cover_image(saved_album.cover_image_url);
    // A complete file appears under its final name only through the rename, so quitting
    // mid-write leaves a ".partial" file, which the next sync deletes as unused.
    const partial_cover_relative_path = `${cover_relative_path}.partial`;
    await writeFile(partial_cover_relative_path, cover_image_bytes, { baseDir: BaseDirectory.AppData });
    await rename(partial_cover_relative_path, cover_relative_path, {
      oldPathBaseDir: BaseDirectory.AppData,
      newPathBaseDir: BaseDirectory.AppData,
    });
  }
  // album_cover_thumbnail_and_colour.rs decodes the cover once, off the webview, for both.
  const cover_dominant_colour = await invoke<string>("write_album_cover_thumbnail_and_sample_colour", {
    coverFileName: album_cover_file_name(saved_album.cover_image_url),
    thumbnailFileName: album_cover_thumbnail_file_name(saved_album.cover_image_url),
    thumbnailSizePx: ALBUM_COVER_THUMBNAIL_SIZE_PX,
  });
  return { ...saved_album, cover_dominant_colour };
}

async function download_largest_cover_image(cover_image_url: string): Promise<Uint8Array> {
  const large_cover_image_url = derive_large_cover_image_url(cover_image_url);
  if (large_cover_image_url) {
    const large_cover_response = await fetch(large_cover_image_url).catch(() => null);
    if (large_cover_response?.ok) {
      return new Uint8Array(await large_cover_response.arrayBuffer());
    }
  }
  const cover_response = await fetch(cover_image_url);
  if (!cover_response.ok) {
    throw new Error(`Cover download failed (${cover_response.status})`);
  }
  return new Uint8Array(await cover_response.arrayBuffer());
}

async function delete_unused_cover_files(saved_albums: readonly SavedAlbum[]): Promise<void> {
  const used_cover_file_names = new Set(
    saved_albums.flatMap((saved_album) =>
      saved_album.cover_image_url
        ? [
            album_cover_file_name(saved_album.cover_image_url),
            album_cover_thumbnail_file_name(saved_album.cover_image_url),
          ]
        : [],
    ),
  );
  const cover_directory_entries = await readDir(ALBUM_COVERS_DIRECTORY_NAME, { baseDir: BaseDirectory.AppData });
  for (const cover_directory_entry of cover_directory_entries) {
    if (cover_directory_entry.isFile && !used_cover_file_names.has(cover_directory_entry.name)) {
      await remove(`${ALBUM_COVERS_DIRECTORY_NAME}/${cover_directory_entry.name}`, { baseDir: BaseDirectory.AppData });
    }
  }
}
