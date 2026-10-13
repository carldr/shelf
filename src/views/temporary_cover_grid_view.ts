import { album_cover_file_url } from "../library/album_cover_cache";
import type { SavedAlbum } from "../library/saved_album";
import { SAVED_ALBUM_SORT_ORDER_LABELS, type SavedAlbumSortOrder } from "../library/saved_album_sort_order";

/**
 * A plain grid of cached covers with their sampled colours, to check the synced data.
 * The shelf replaces it in milestone 4.
 */
export interface TemporaryCoverGridViewOptions {
  sorted_saved_albums: readonly SavedAlbum[];
  saved_album_sort_order: SavedAlbumSortOrder;
  on_sort_order_change: (saved_album_sort_order: SavedAlbumSortOrder) => void;
  on_refresh_library: () => void;
  on_open_settings: () => void;
}

export interface TemporaryCoverGridView {
  show_sync_status(sync_status_text: string): void;
}

export function render_temporary_cover_grid_view(
  container: HTMLElement,
  options: TemporaryCoverGridViewOptions,
): TemporaryCoverGridView {
  container.innerHTML = `
    <section class="temporary_cover_grid_view">
      <header class="temporary_cover_grid_view_toolbar">
        <span class="temporary_cover_grid_view_album_count"></span>
        <span class="temporary_cover_grid_view_sync_status" role="status"></span>
        <select class="temporary_cover_grid_view_sort_order" aria-label="Sort order"></select>
        <button type="button" class="temporary_cover_grid_view_refresh_button">Refresh</button>
        <button type="button" class="temporary_cover_grid_view_settings_button">Settings</button>
      </header>
      <ol class="temporary_cover_grid_view_covers"></ol>
    </section>`;

  container.querySelector(".temporary_cover_grid_view_album_count")!.textContent =
    `${options.sorted_saved_albums.length} albums`;

  const sort_order_select = container.querySelector<HTMLSelectElement>(".temporary_cover_grid_view_sort_order")!;
  for (const [saved_album_sort_order, sort_order_label] of Object.entries(SAVED_ALBUM_SORT_ORDER_LABELS)) {
    sort_order_select.add(new Option(sort_order_label, saved_album_sort_order));
  }
  sort_order_select.value = options.saved_album_sort_order;
  sort_order_select.addEventListener("change", () =>
    options.on_sort_order_change(sort_order_select.value as SavedAlbumSortOrder),
  );
  container
    .querySelector(".temporary_cover_grid_view_refresh_button")!
    .addEventListener("click", options.on_refresh_library);
  container
    .querySelector(".temporary_cover_grid_view_settings_button")!
    .addEventListener("click", options.on_open_settings);

  const covers_list = container.querySelector(".temporary_cover_grid_view_covers")!;
  const cover_list_items = options.sorted_saved_albums.map((saved_album) => {
    const cover_list_item = document.createElement("li");
    cover_list_item.title = `${saved_album.artist_names} — ${saved_album.album_name}${
      saved_album.release_year ? ` (${saved_album.release_year})` : ""
    }`;
    const cover_image = document.createElement("img");
    cover_image.loading = "lazy";
    cover_image.alt = "";
    if (saved_album.cover_image_url) {
      cover_image.src = album_cover_file_url(saved_album.spotify_album_id);
    }
    const dominant_colour_bar = document.createElement("span");
    dominant_colour_bar.style.background = saved_album.cover_dominant_colour ?? "transparent";
    cover_list_item.append(cover_image, dominant_colour_bar);
    return cover_list_item;
  });
  covers_list.append(...cover_list_items);

  const sync_status_element = container.querySelector(".temporary_cover_grid_view_sync_status")!;
  return {
    show_sync_status: (sync_status_text) => {
      sync_status_element.textContent = sync_status_text;
    },
  };
}
