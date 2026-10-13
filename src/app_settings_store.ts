import { BaseDirectory, exists, mkdir, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import type { SavedAlbumSortOrder } from "./library/saved_album_sort_order";

const APP_SETTINGS_FILE_NAME = "app_settings.json";

export interface AppSettings {
  /** The user's own Spotify app Client ID. Shelf ships with none. */
  spotify_client_id: string | null;
  saved_album_sort_order: SavedAlbumSortOrder;
  /** The shelf shows a generated library and needs no Spotify setup. Connecting Spotify turns it off. */
  demo_mode_enabled: boolean;
  /** Shelf starts when the user logs in. On by default. */
  start_at_login: boolean;
}

const DEFAULT_APP_SETTINGS: AppSettings = {
  spotify_client_id: null,
  saved_album_sort_order: "recently_added",
  demo_mode_enabled: false,
  start_at_login: true,
};

export async function load_app_settings(): Promise<AppSettings> {
  if (!(await exists(APP_SETTINGS_FILE_NAME, { baseDir: BaseDirectory.AppData }))) {
    return { ...DEFAULT_APP_SETTINGS };
  }
  const stored_app_settings = JSON.parse(
    await readTextFile(APP_SETTINGS_FILE_NAME, { baseDir: BaseDirectory.AppData }),
  ) as Partial<AppSettings>;
  return { ...DEFAULT_APP_SETTINGS, ...stored_app_settings };
}

export async function save_app_settings(app_settings: AppSettings): Promise<void> {
  await mkdir("", { baseDir: BaseDirectory.AppData, recursive: true });
  await writeTextFile(APP_SETTINGS_FILE_NAME, JSON.stringify(app_settings, null, 2), {
    baseDir: BaseDirectory.AppData,
  });
}
