import { BaseDirectory, exists, mkdir, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import type { SavedAlbum } from "./saved_album";

const SAVED_ALBUMS_LIBRARY_FILE_NAME = "albums.json";

/** Shelf syncs on launch when the stored library is older than this. */
const SAVED_ALBUMS_LIBRARY_MAXIMUM_AGE_MS = 6 * 60 * 60 * 1000;

/** The contents of albums.json in the app data directory. */
export interface SavedAlbumsLibrary {
  /** ISO 8601 timestamp of the last completed sync. */
  synced_at: string;
  saved_albums: SavedAlbum[];
}

export async function load_saved_albums_library(): Promise<SavedAlbumsLibrary | null> {
  if (!(await exists(SAVED_ALBUMS_LIBRARY_FILE_NAME, { baseDir: BaseDirectory.AppData }))) {
    return null;
  }
  return JSON.parse(
    await readTextFile(SAVED_ALBUMS_LIBRARY_FILE_NAME, { baseDir: BaseDirectory.AppData }),
  ) as SavedAlbumsLibrary;
}

export async function save_saved_albums_library(saved_albums_library: SavedAlbumsLibrary): Promise<void> {
  await mkdir("", { baseDir: BaseDirectory.AppData, recursive: true });
  await writeTextFile(SAVED_ALBUMS_LIBRARY_FILE_NAME, JSON.stringify(saved_albums_library), {
    baseDir: BaseDirectory.AppData,
  });
}

export function is_saved_albums_library_stale(saved_albums_library: SavedAlbumsLibrary | null, now_ms = Date.now()): boolean {
  return !saved_albums_library || now_ms - Date.parse(saved_albums_library.synced_at) > SAVED_ALBUMS_LIBRARY_MAXIMUM_AGE_MS;
}
