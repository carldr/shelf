import { convertFileSrc } from "@tauri-apps/api/core";
import { appDataDir, join } from "@tauri-apps/api/path";
import { BaseDirectory, exists, mkdir, readDir, readFile, remove, writeFile } from "@tauri-apps/plugin-fs";
import { compute_dominant_colour_from_image_blob } from "./album_dominant_colour";
import type { SavedAlbum } from "./saved_album";

const ALBUM_COVERS_DIRECTORY_NAME = "covers";
const PARALLEL_COVER_DOWNLOADS = 6;

/**
 * Names the cached file after the image ID at the end of the cover URL, such as
 * https://i.scdn.co/image/ab67616d0000b273… When Spotify or Shelf changes the image,
 * the URL changes, so the new image is downloaded and the old file is deleted as unused.
 */
function album_cover_file_name(cover_image_url: string): string {
  return `${cover_image_url.slice(cover_image_url.lastIndexOf("/") + 1)}.jpg`;
}

function album_cover_relative_path(cover_image_url: string): string {
  return `${ALBUM_COVERS_DIRECTORY_NAME}/${album_cover_file_name(cover_image_url)}`;
}

let album_covers_directory_path: string | null = null;

/** Resolves the covers directory once; call before album_cover_file_url. */
export async function resolve_album_covers_directory_path(): Promise<void> {
  album_covers_directory_path = await join(await appDataDir(), ALBUM_COVERS_DIRECTORY_NAME);
}

/** An asset-protocol URL that the webview can load as an image, or null when the album has no cover. */
export function album_cover_file_url(saved_album: SavedAlbum): string | null {
  if (!album_covers_directory_path) {
    throw new Error("resolve_album_covers_directory_path has not run.");
  }
  if (!saved_album.cover_image_url) {
    return null;
  }
  return convertFileSrc(`${album_covers_directory_path}/${album_cover_file_name(saved_album.cover_image_url)}`);
}

/**
 * Downloads each album's cover once into the covers directory and samples its dominant colour.
 * Covers already on disk are not downloaded again. Files that no saved album uses are deleted.
 * Returns the albums with `cover_dominant_colour` filled in where a cover exists.
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
  const cover_relative_path = album_cover_relative_path(saved_album.cover_image_url);
  const cover_is_cached = await exists(cover_relative_path, { baseDir: BaseDirectory.AppData });
  if (cover_is_cached && saved_album.cover_dominant_colour) {
    return saved_album;
  }

  let cover_image_bytes: Uint8Array;
  if (cover_is_cached) {
    cover_image_bytes = await readFile(cover_relative_path, { baseDir: BaseDirectory.AppData });
  } else {
    const cover_response = await fetch(saved_album.cover_image_url);
    if (!cover_response.ok) {
      throw new Error(`Cover download failed (${cover_response.status})`);
    }
    cover_image_bytes = new Uint8Array(await cover_response.arrayBuffer());
    await writeFile(cover_relative_path, cover_image_bytes, { baseDir: BaseDirectory.AppData });
  }
  const cover_dominant_colour = await compute_dominant_colour_from_image_blob(
    new Blob([cover_image_bytes as BlobPart], { type: "image/jpeg" }),
  );
  return { ...saved_album, cover_dominant_colour };
}

async function delete_unused_cover_files(saved_albums: readonly SavedAlbum[]): Promise<void> {
  const used_cover_file_names = new Set(
    saved_albums.flatMap((saved_album) =>
      saved_album.cover_image_url ? [album_cover_file_name(saved_album.cover_image_url)] : [],
    ),
  );
  const cover_directory_entries = await readDir(ALBUM_COVERS_DIRECTORY_NAME, { baseDir: BaseDirectory.AppData });
  for (const cover_directory_entry of cover_directory_entries) {
    if (cover_directory_entry.isFile && !used_cover_file_names.has(cover_directory_entry.name)) {
      await remove(`${ALBUM_COVERS_DIRECTORY_NAME}/${cover_directory_entry.name}`, { baseDir: BaseDirectory.AppData });
    }
  }
}
