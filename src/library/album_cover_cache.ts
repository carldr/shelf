import { convertFileSrc } from "@tauri-apps/api/core";
import { appDataDir, join } from "@tauri-apps/api/path";
import { BaseDirectory, exists, mkdir, readDir, readFile, remove, writeFile } from "@tauri-apps/plugin-fs";
import { compute_dominant_colour_from_image_blob } from "./album_dominant_colour";
import type { SavedAlbum } from "./saved_album";

const ALBUM_COVERS_DIRECTORY_NAME = "covers";
const PARALLEL_COVER_DOWNLOADS = 6;

function album_cover_relative_path(spotify_album_id: string): string {
  return `${ALBUM_COVERS_DIRECTORY_NAME}/${spotify_album_id}.jpg`;
}

let album_covers_directory_path: string | null = null;

/** Resolves the covers directory once; call before album_cover_file_url. */
export async function resolve_album_covers_directory_path(): Promise<void> {
  album_covers_directory_path = await join(await appDataDir(), ALBUM_COVERS_DIRECTORY_NAME);
}

/** An asset-protocol URL that the webview can load as an image. */
export function album_cover_file_url(spotify_album_id: string): string {
  if (!album_covers_directory_path) {
    throw new Error("resolve_album_covers_directory_path has not run.");
  }
  return convertFileSrc(`${album_covers_directory_path}/${spotify_album_id}.jpg`);
}

/**
 * Downloads each album's cover once into the covers directory and samples its dominant colour.
 * Covers already on disk are not downloaded again. Covers of albums no longer saved are deleted.
 * Returns the albums with `cover_dominant_colour` filled in where a cover exists.
 */
export async function cache_album_covers(
  saved_albums: readonly SavedAlbum[],
  on_progress: (cached_cover_count: number, total_cover_count: number) => void = () => {},
): Promise<SavedAlbum[]> {
  await mkdir(ALBUM_COVERS_DIRECTORY_NAME, { baseDir: BaseDirectory.AppData, recursive: true });
  await delete_covers_of_removed_albums(saved_albums);

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
  const cover_relative_path = album_cover_relative_path(saved_album.spotify_album_id);
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

async function delete_covers_of_removed_albums(saved_albums: readonly SavedAlbum[]): Promise<void> {
  const saved_album_ids = new Set(saved_albums.map((saved_album) => saved_album.spotify_album_id));
  const cover_directory_entries = await readDir(ALBUM_COVERS_DIRECTORY_NAME, { baseDir: BaseDirectory.AppData });
  for (const cover_directory_entry of cover_directory_entries) {
    const spotify_album_id = cover_directory_entry.name.replace(/\.jpg$/, "");
    if (cover_directory_entry.isFile && !saved_album_ids.has(spotify_album_id)) {
      await remove(`${ALBUM_COVERS_DIRECTORY_NAME}/${cover_directory_entry.name}`, { baseDir: BaseDirectory.AppData });
    }
  }
}
