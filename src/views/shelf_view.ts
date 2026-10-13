import type { SavedAlbum } from "../library/saved_album";
import { SAVED_ALBUM_SORT_ORDER_LABELS, type SavedAlbumSortOrder } from "../library/saved_album_sort_order";
import { album_cover_file_url } from "../library/album_cover_cache";
import { ShelfRenderer } from "../shelf/shelf_renderer";

export interface ShelfViewOptions {
  saved_album_sort_order: SavedAlbumSortOrder;
  on_sort_order_change: (saved_album_sort_order: SavedAlbumSortOrder) => void;
  on_refresh_library: () => void;
  on_open_settings: () => void;
  on_album_click: (saved_album: SavedAlbum) => void;
}

export interface ShelfView {
  show_albums(sorted_saved_albums: readonly SavedAlbum[]): void;
  show_sync_status(sync_status_text: string): void;
  pause(): void;
  resume(): void;
}

/**
 * Dev builds only: `VITE_SHELF_STRESS_TEST_ALBUM_COUNT=1200 pnpm tauri dev` repeats the library
 * to that many albums, sweeps the shelf back and forth, and shows frame timings in the toolbar.
 */
const STRESS_TEST_ALBUM_COUNT = import.meta.env.DEV
  ? Number(import.meta.env.VITE_SHELF_STRESS_TEST_ALBUM_COUNT ?? 0)
  : 0;

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
      </header>
      <div class="shelf_view_canvas_host"></div>
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

  const frame_durations_ms: number[] = [];
  const shelf_renderer = await ShelfRenderer.create({
    host_element: container.querySelector(".shelf_view_canvas_host")!,
    cover_url_for_album: album_cover_file_url,
    on_album_click: options.on_album_click,
    on_frame: STRESS_TEST_ALBUM_COUNT ? (frame_duration_ms) => frame_durations_ms.push(frame_duration_ms) : undefined,
  });

  if (STRESS_TEST_ALBUM_COUNT) {
    run_stress_test_sweep(shelf_renderer, frame_durations_ms, (stress_test_report) => {
      sync_status_element.textContent = stress_test_report;
    });
  }

  return {
    show_albums(sorted_saved_albums) {
      const shown_albums = STRESS_TEST_ALBUM_COUNT
        ? repeat_albums_to_count(sorted_saved_albums, STRESS_TEST_ALBUM_COUNT)
        : sorted_saved_albums;
      album_count_element.textContent = `${shown_albums.length} albums`;
      shelf_renderer.set_albums(shown_albums);
    },
    show_sync_status(sync_status_text) {
      if (!STRESS_TEST_ALBUM_COUNT) {
        sync_status_element.textContent = sync_status_text;
      }
    },
    pause: () => shelf_renderer.pause(),
    resume: () => shelf_renderer.resume(),
  };
}

function repeat_albums_to_count(saved_albums: readonly SavedAlbum[], album_count: number): SavedAlbum[] {
  if (saved_albums.length === 0) {
    return [];
  }
  return Array.from({ length: album_count }, (_, album_index) => saved_albums[album_index % saved_albums.length]);
}

/** Sweeps from one end of the shelf to the other every 8 seconds and reports frame timings each second. */
function run_stress_test_sweep(
  shelf_renderer: ShelfRenderer,
  frame_durations_ms: number[],
  show_report: (stress_test_report: string) => void,
): void {
  const sweep_period_ms = 8000;
  const sweep_start_ms = performance.now();
  const move_scroll_target = () => {
    const sweep_phase = ((performance.now() - sweep_start_ms) % sweep_period_ms) / sweep_period_ms;
    const sweep_position = sweep_phase < 0.5 ? sweep_phase * 2 : 2 - sweep_phase * 2;
    shelf_renderer.scroll_to(sweep_position * shelf_renderer.maximum_scroll_x);
    requestAnimationFrame(move_scroll_target);
  };
  requestAnimationFrame(move_scroll_target);

  setInterval(() => {
    if (frame_durations_ms.length === 0) {
      return;
    }
    const sorted_durations = [...frame_durations_ms].sort((first, second) => first - second);
    const median_ms = sorted_durations[Math.floor(sorted_durations.length / 2)];
    const worst_percentile_ms = sorted_durations[Math.floor(sorted_durations.length * 0.99)];
    const long_frame_count = frame_durations_ms.filter((frame_duration_ms) => frame_duration_ms > 20).length;
    show_report(
      `Stress test: ${frame_durations_ms.length} frames/s, median ${median_ms.toFixed(1)} ms, ` +
        `99th percentile ${worst_percentile_ms.toFixed(1)} ms, ${long_frame_count} frames over 20 ms`,
    );
    console.info(`[shelf_stress_test] ${frame_durations_ms.length} ${median_ms} ${worst_percentile_ms} ${long_frame_count}`);
    frame_durations_ms.length = 0;
  }, 1000);
}
