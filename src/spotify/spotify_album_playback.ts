import { SpotifyWebApiError, type SpotifyWebApiClient } from "./spotify_web_api_client";

/** How long Shelf waits for a freshly opened Spotify app to register as a device. */
const SPOTIFY_APP_STARTUP_TIMEOUT_MS = 15_000;
const SPOTIFY_DEVICE_POLL_INTERVAL_MS = 1_000;

export interface SpotifyPlaybackDevice {
  id: string | null;
  name: string;
  type: string;
  is_active: boolean;
}

export interface SpotifyAlbumPlaybackDependencies {
  spotify_web_api_client: Pick<SpotifyWebApiClient, "get_json" | "send_request">;
  /** This machine's hostname, such as "Office-Computer.local". */
  hostname: string;
  /** Opens a spotify: URI, which starts the Spotify app if it is not running. */
  open_url: (url: string) => Promise<void>;
  wait_milliseconds: (milliseconds: number) => Promise<void>;
}

/** Lowercase letters and digits only, so "Office Computer" matches "Office-Computer.local". */
function normalise_device_name(device_name: string): string {
  return device_name
    .toLowerCase()
    .replace(/\.local$/, "")
    .replace(/[^a-z0-9]/g, "");
}

/**
 * The active device if there is one, otherwise the Spotify app on this computer.
 * The Spotify desktop app names its device after the computer, so the names are compared
 * with punctuation and the ".local" suffix removed.
 */
export function choose_spotify_playback_device(
  spotify_playback_devices: readonly SpotifyPlaybackDevice[],
  hostname: string,
): string | null {
  const active_device = spotify_playback_devices.find((device) => device.is_active && device.id);
  if (active_device) {
    return active_device.id;
  }
  const normalised_hostname = normalise_device_name(hostname);
  const this_computer = spotify_playback_devices.find(
    (device) => device.type === "Computer" && device.id && normalise_device_name(device.name) === normalised_hostname,
  );
  return this_computer?.id ?? null;
}

async function fetch_spotify_playback_devices(
  spotify_web_api_client: SpotifyAlbumPlaybackDependencies["spotify_web_api_client"],
): Promise<SpotifyPlaybackDevice[]> {
  const device_list = await spotify_web_api_client.get_json<{ devices: SpotifyPlaybackDevice[] }>("/me/player/devices");
  return device_list.devices;
}

/**
 * Starts `spotify_album_uri` from its first track.
 * Without a usable device, it opens the album in the Spotify app, waits for this computer
 * to appear as a device, and then plays there.
 */
export async function play_spotify_album(
  spotify_album_uri: string,
  dependencies: SpotifyAlbumPlaybackDependencies,
): Promise<void> {
  let device_id = choose_spotify_playback_device(
    await fetch_spotify_playback_devices(dependencies.spotify_web_api_client),
    dependencies.hostname,
  );
  if (!device_id) {
    await dependencies.open_url(spotify_album_uri);
    for (
      let waited_ms = 0;
      !device_id && waited_ms < SPOTIFY_APP_STARTUP_TIMEOUT_MS;
      waited_ms += SPOTIFY_DEVICE_POLL_INTERVAL_MS
    ) {
      await dependencies.wait_milliseconds(SPOTIFY_DEVICE_POLL_INTERVAL_MS);
      device_id = choose_spotify_playback_device(
        await fetch_spotify_playback_devices(dependencies.spotify_web_api_client),
        dependencies.hostname,
      );
    }
  }
  if (!device_id) {
    throw new SpotifyWebApiError(404, "NO_ACTIVE_DEVICE", "No Spotify device appeared.");
  }
  await dependencies.spotify_web_api_client.send_request(
    `/me/player/play?device_id=${encodeURIComponent(device_id)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ context_uri: spotify_album_uri }),
    },
  );
}

/** A short message for the shelf, for the playback errors a user can act on. */
export function describe_spotify_playback_error(playback_error: unknown): string {
  if (playback_error instanceof SpotifyWebApiError) {
    if (playback_error.spotify_reason === "NO_ACTIVE_DEVICE") {
      return "No Spotify device is available. Open Spotify and try again.";
    }
    if (playback_error.spotify_reason === "PREMIUM_REQUIRED" || playback_error.http_status === 403) {
      return "Playing from Shelf needs Spotify Premium.";
    }
  }
  return `Spotify could not play the album: ${playback_error instanceof Error ? playback_error.message : String(playback_error)}`;
}
