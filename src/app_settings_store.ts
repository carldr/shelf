import { BaseDirectory, exists, mkdir, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";

const APP_SETTINGS_FILE_NAME = "app_settings.json";

export interface AppSettings {
  /** The user's own Spotify app Client ID. Shelf ships with none. */
  spotify_client_id: string | null;
}

const DEFAULT_APP_SETTINGS: AppSettings = {
  spotify_client_id: null,
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
