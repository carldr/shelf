import type { SavedAlbum } from "../library/saved_album";
import { SAVED_ALBUM_SORT_ORDER_LABELS, type SavedAlbumSortOrder } from "../library/saved_album_sort_order";
import { ShelfRenderer, type ShelfFrameTiming } from "../shelf/shelf_renderer";

export interface ShelfViewOptions {
  saved_album_sort_order: SavedAlbumSortOrder;
  on_sort_order_change: (saved_album_sort_order: SavedAlbumSortOrder) => void;
  on_refresh_library: () => void;
  on_open_settings: () => void;
  on_quit: () => void;
  on_album_click: (saved_album: SavedAlbum) => void;
  /** Cached Spotify covers, or generated covers in demo mode. */
  load_cover_bitmap: (saved_album: SavedAlbum, size_px: number) => Promise<ImageBitmap | null>;
  /** Cached Spotify cover thumbnails, or generated ones in demo mode. */
  load_cover_thumbnail_bitmap: (saved_album: SavedAlbum) => Promise<ImageBitmap | null>;
}

/** An inline message stays on the shelf this long. */
const SHELF_MESSAGE_DURATION_MS = 5_000;

export interface ShelfView {
  /** Shows a short message over the shelf, such as a playback error. */
  show_message(message_text: string): void;
  set_now_playing_album(spotify_album_id: string | null): void;
  /** Puts the album in the middle, open. Returns false if it is not in the library. */
  jump_to_album(spotify_album_id: string): boolean;
  show_albums(sorted_saved_albums: readonly SavedAlbum[]): void;
  show_sync_status(sync_status_text: string): void;
  /**
   * While a sync runs, covers the shelf with a spinner and `sync_progress_text`, stops drawing,
   * and disables the toolbar controls, because the library changes under the shelf. Null ends it.
   */
  show_sync_in_progress(sync_progress_text: string | null): void;
  pause(): void;
  resume(): void;
}

/**
 * Dev builds only: `VITE_SHELF_STRESS_TEST_ALBUM_COUNT=1200 pnpm tauri dev` repeats the library
 * to that many albums, sweeps the shelf back and forth, and reports frame timings each second
 * in the toolbar and the dev terminal.
 * VITE_SHELF_STRESS_TEST_WITHOUT_COVERS=1 and VITE_SHELF_STRESS_TEST_WITHOUT_JEWEL_CASE=1 leave
 * those parts out, to find what limits the frame rate.
 */
const STRESS_TEST_ALBUM_COUNT = import.meta.env.DEV
  ? Number(import.meta.env.VITE_SHELF_STRESS_TEST_ALBUM_COUNT ?? 0)
  : 0;
const STRESS_TEST_SWITCHES = {
  without_covers: import.meta.env.DEV && import.meta.env.VITE_SHELF_STRESS_TEST_WITHOUT_COVERS === "1",
  without_jewel_case: import.meta.env.DEV && import.meta.env.VITE_SHELF_STRESS_TEST_WITHOUT_JEWEL_CASE === "1",
};

/** The library screen: a toolbar above the shelf. Create it once; the shelf keeps its GPU state between showings. */
export async function create_shelf_view(container: HTMLElement, options: ShelfViewOptions): Promise<ShelfView> {
  container.innerHTML = `
    <section class="shelf_view">
      <header class="shelf_view_toolbar">
        <span class="shelf_view_album_count"></span>
        <span class="shelf_view_sync_status" role="status"></span>
        <select class="shelf_view_sort_order" aria-label="Sort order"></select>
        <button type="button" class="shelf_view_refresh_button" title="Refresh library">Refresh</button>
        <button type="button" class="shelf_view_settings_button" title="Settings">Settings</button>
        <button type="button" class="shelf_view_quit_button" title="Quit Shelf">Quit</button>
      </header>
      <div class="shelf_view_canvas_host">
        <p class="shelf_view_message" role="alert" hidden></p>
        <div class="shelf_view_sync_overlay" hidden>
          <div class="shelf_view_sync_spinner" aria-hidden="true"></div>
          <p class="shelf_view_sync_progress" role="status"></p>
        </div>
      </div>
    </section>`;

  const album_count_element = container.querySelector(".shelf_view_album_count")!;
  const sync_status_element = container.querySelector(".shelf_view_sync_status")!;
  const sort_order_select = container.querySelector<HTMLSelectElement>(".shelf_view_sort_order")!;
  for (const [saved_album_sort_order, sort_order_label] of Object.entries(SAVED_ALBUM_SORT_ORDER_LABELS)) {
    sort_order_select.add(new Option(sort_order_label, saved_album_sort_order));
  }
  sort_order_select.value = options.saved_album_sort_order;
  sort_order_select.addEventListener("change", () =>
    options.on_sort_order_change(sort_order_select.value as SavedAlbumSortOrder),
  );
  container.querySelector(".shelf_view_refresh_button")!.addEventListener("click", options.on_refresh_library);
  container.querySelector(".shelf_view_settings_button")!.addEventListener("click", options.on_open_settings);
  container.querySelector(".shelf_view_quit_button")!.addEventListener("click", options.on_quit);

  const message_element = container.querySelector<HTMLElement>(".shelf_view_message")!;
  let message_timer: ReturnType<typeof setTimeout> | undefined;
  const sync_overlay_element = container.querySelector<HTMLElement>(".shelf_view_sync_overlay")!;
  const sync_progress_element = container.querySelector<HTMLElement>(".shelf_view_sync_progress")!;
  const toolbar_controls = container.querySelectorAll<HTMLButtonElement | HTMLSelectElement>(
    // Quit stays enabled during a sync.
    ".shelf_view_toolbar button:not(.shelf_view_quit_button), .shelf_view_toolbar select",
  );
  let sync_in_progress = false;
  let window_shown = true;

  const shelf_frame_timings: ShelfFrameTiming[] = [];
  let cover_load_count = 0;
  const shelf_renderer = await ShelfRenderer.create({
    host_element: container.querySelector(".shelf_view_canvas_host")!,
    load_cover_bitmap: STRESS_TEST_ALBUM_COUNT
      ? (saved_album, size_px) => {
          cover_load_count += 1;
          return options.load_cover_bitmap(saved_album, size_px);
        }
      : options.load_cover_bitmap,
    load_cover_thumbnail_bitmap: options.load_cover_thumbnail_bitmap,
    on_album_click: options.on_album_click,
    on_frame: STRESS_TEST_ALBUM_COUNT ? (shelf_frame_timing) => shelf_frame_timings.push(shelf_frame_timing) : undefined,
    stress_test_switches: STRESS_TEST_SWITCHES,
  });

  if (STRESS_TEST_ALBUM_COUNT) {
    run_stress_test_sweep(
      shelf_renderer,
      shelf_frame_timings,
      () => {
        const counted_cover_loads = cover_load_count;
        cover_load_count = 0;
        return counted_cover_loads;
      },
      (stress_test_report) => {
        sync_status_element.textContent = stress_test_report;
      },
    );
  }

  return {
    show_albums(sorted_saved_albums) {
      const shown_albums = STRESS_TEST_ALBUM_COUNT
        ? repeat_albums_to_count(sorted_saved_albums, STRESS_TEST_ALBUM_COUNT)
        : sorted_saved_albums;
      album_count_element.textContent = `${shown_albums.length} albums`;
      shelf_renderer.set_albums(shown_albums);
    },
    show_message(message_text) {
      message_element.textContent = message_text;
      message_element.hidden = false;
      clearTimeout(message_timer);
      message_timer = setTimeout(() => (message_element.hidden = true), SHELF_MESSAGE_DURATION_MS);
    },
    set_now_playing_album: (spotify_album_id) => shelf_renderer.set_now_playing_album(spotify_album_id),
    jump_to_album: (spotify_album_id) => shelf_renderer.jump_to_album(spotify_album_id),
    show_sync_status(sync_status_text) {
      if (!STRESS_TEST_ALBUM_COUNT) {
        sync_status_element.textContent = sync_status_text;
      }
    },
    show_sync_in_progress(sync_progress_text) {
      sync_in_progress = sync_progress_text !== null;
      sync_overlay_element.hidden = !sync_in_progress;
      sync_progress_element.textContent = sync_progress_text ?? "";
      for (const toolbar_control of toolbar_controls) {
        toolbar_control.disabled = sync_in_progress;
      }
      if (sync_in_progress) {
        shelf_renderer.pause();
      } else if (window_shown) {
        shelf_renderer.resume();
      }
    },
    pause() {
      window_shown = false;
      shelf_renderer.pause();
    },
    resume() {
      window_shown = true;
      if (!sync_in_progress) {
        shelf_renderer.resume();
      }
    },
  };
}

function repeat_albums_to_count(saved_albums: readonly SavedAlbum[], album_count: number): SavedAlbum[] {
  if (saved_albums.length === 0) {
    return [];
  }
  return Array.from({ length: album_count }, (_, album_index) => saved_albums[album_index % saved_albums.length]);
}

function median(values: number[]): number {
  const sorted_values = [...values].sort((first, second) => first - second);
  return sorted_values[Math.floor(sorted_values.length / 2)];
}

/** Sweeps from one end of the shelf to the other every 8 seconds and reports frame timings each second. */
function run_stress_test_sweep(
  shelf_renderer: ShelfRenderer,
  shelf_frame_timings: ShelfFrameTiming[],
  take_cover_load_count: () => number,
  show_report: (stress_test_report: string) => void,
): void {
  const switch_names = Object.entries(STRESS_TEST_SWITCHES)
    .filter(([, switch_enabled]) => switch_enabled)
    .map(([switch_name]) => switch_name);
  const sweep_period_ms = 8000;
  const sweep_start_ms = performance.now();
  const move_scroll_target = () => {
    const sweep_phase = ((performance.now() - sweep_start_ms) % sweep_period_ms) / sweep_period_ms;
    const sweep_position = sweep_phase < 0.5 ? sweep_phase * 2 : 2 - sweep_phase * 2;
    const { minimum_scroll_x, maximum_scroll_x } = shelf_renderer.scroll_x_range;
    shelf_renderer.scroll_to(minimum_scroll_x + sweep_position * (maximum_scroll_x - minimum_scroll_x));
    requestAnimationFrame(move_scroll_target);
  };
  requestAnimationFrame(move_scroll_target);

  setInterval(() => {
    const cover_loads = take_cover_load_count();
    if (shelf_frame_timings.length === 0) {
      return;
    }
    const frame_durations_ms = shelf_frame_timings.map((shelf_frame_timing) => shelf_frame_timing.frame_duration_ms);
    const sorted_durations = [...frame_durations_ms].sort((first, second) => first - second);
    const stress_test_measurements = {
      frames: shelf_frame_timings.length,
      median_frame_ms: median(frame_durations_ms).toFixed(1),
      p99_frame_ms: sorted_durations[Math.floor(sorted_durations.length * 0.99)].toFixed(1),
      frames_over_20_ms: frame_durations_ms.filter((frame_duration_ms) => frame_duration_ms > 20).length,
      median_layout_ms: median(shelf_frame_timings.map((shelf_frame_timing) => shelf_frame_timing.layout_ms)).toFixed(2),
      median_render_ms: median(shelf_frame_timings.map((shelf_frame_timing) => shelf_frame_timing.render_ms)).toFixed(2),
      cover_loads,
      switches: switch_names.join(",") || "none",
    };
    const stress_test_report = Object.entries(stress_test_measurements)
      .map(([measurement_name, measurement_value]) => `${measurement_name}=${measurement_value}`)
      .join(" ");
    show_report(stress_test_report);
    console.info(`[shelf_stress_test] ${stress_test_report}`);
    shelf_frame_timings.length = 0;
  }, 1000);
}
