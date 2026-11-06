import { format_album_track_duration, type AlbumTrack } from "../library/album_tracks";
import type { SavedAlbum } from "../library/saved_album";
import { compute_album_back_track_row_layout } from "./album_back_track_list_layout";
import { JEWEL_CASE_BACK_COLOUR, JEWEL_CASE_CAP_HEIGHT_RATIO, type SettledOpenAlbum } from "./shelf_renderer";
import { choose_spine_label_colour, parse_hex_colour } from "./shelf_spine_label";

/** The turn from the cover to the back, and from the back to the cover, takes this long. */
const ALBUM_SPIN_DURATION_MS = 400;
/** The spin button sits this far in from the top left corner of the cover. */
const SPIN_BUTTON_INSET = 8;
/** The thumbnail on the back, as a share of the cover size. It matches `--album_back_thumbnail_size` in styles.css. */
const ALBUM_BACK_THUMBNAIL_SIZE_TO_COVER_SIZE_RATIO = 0.13;
const FALLBACK_SPINE_COLOUR = "#808080";
/** A long album name scrolls at this speed to show its end, and back. */
const ALBUM_NAME_SCROLL_SPEED_PX_PER_S = 30;
/** The album name rests at its start this long between scrolls, and this long before the first one. */
const ALBUM_NAME_REST_AT_START_MS = 3_000;
const ALBUM_NAME_FIRST_SCROLL_DELAY_MS = 1_000;
/** The album name rests at its end this long before it scrolls back. */
const ALBUM_NAME_REST_AT_END_MS = 1_000;
/** An end of the album name with text hidden past it fades out over this width. */
const ALBUM_NAME_FADE_WIDTH = "1.25em";

export interface ShelfAlbumSpinLayerOptions {
  host_element: HTMLElement;
  /** Produces the album's full cover at `size_px` square, or null when it has none. */
  load_cover_bitmap: (saved_album: SavedAlbum, size_px: number) => Promise<ImageBitmap | null>;
  load_album_tracks: (saved_album: SavedAlbum) => Promise<AlbumTrack[]>;
  on_track_click: (saved_album: SavedAlbum, album_track: AlbumTrack) => void;
  /**
   * Receives the album when the spin starts, and null when the album is back on the shelf.
   * In between, this layer draws the album, and the shelf must not move.
   */
  on_spinning_album_change: (spinning_album: SavedAlbum | null) => void;
}

type AlbumSpinState = "showing_cover" | "turning_to_back" | "showing_back" | "turning_to_cover";

/**
 * Turns the open album round to show its track list. The album is drawn as a 3D jewel case in HTML over the shelf:
 * the cover on the front, the track list on the back, and the spine on the side that passes the viewer.
 */
export class ShelfAlbumSpinLayer {
  private readonly spin_button = document.createElement("button");
  private settled_open_album: SettledOpenAlbum | null = null;
  private album_spin_state: AlbumSpinState = "showing_cover";
  private spin_stage: HTMLElement | null = null;
  private spin_box: HTMLElement | null = null;
  private spin_timer: ReturnType<typeof setTimeout> | undefined;
  private now_playing_spotify_track_id: string | null = null;
  private track_rows_by_spotify_track_id = new Map<string, HTMLElement>();

  constructor(private readonly options: ShelfAlbumSpinLayerOptions) {
    this.spin_button.type = "button";
    this.spin_button.className = "shelf_album_spin_button";
    this.spin_button.title = "Spin to see the tracks";
    this.spin_button.setAttribute("aria-label", "Spin to see the tracks");
    this.spin_button.textContent = "↻";
    this.spin_button.hidden = true;
    this.spin_button.addEventListener("click", () => void this.turn_to_back());
    options.host_element.appendChild(this.spin_button);
  }

  /**
   * Shows the spin button on a settled open album. A turned album follows a small move of its cover,
   * and goes back at once when the album changes, the cover size changes, or no album is settled.
   */
  set_settled_open_album(settled_open_album: SettledOpenAlbum | null): void {
    const previous = this.settled_open_album;
    this.settled_open_album = settled_open_album;
    const same_album_and_size =
      previous !== null &&
      settled_open_album !== null &&
      previous.saved_album === settled_open_album.saved_album &&
      previous.cover_size === settled_open_album.cover_size;
    if (this.spin_stage && !same_album_and_size) {
      this.put_album_back_at_once();
    } else if (this.spin_stage && settled_open_album) {
      this.spin_stage.style.left = `${settled_open_album.cover_left_x}px`;
      this.spin_stage.style.top = `${settled_open_album.cover_top_y}px`;
    }
    this.update_spin_button();
  }

  /** Marks the track Spotify is playing on the back of the album. Null clears the mark. */
  set_now_playing_track(spotify_track_id: string | null): void {
    this.now_playing_spotify_track_id = spotify_track_id;
    for (const [row_spotify_track_id, track_row] of this.track_rows_by_spotify_track_id) {
      track_row.classList.toggle("shelf_album_back_track_row_now_playing", row_spotify_track_id === spotify_track_id);
    }
  }

  /** Turns the album from its back to its cover, then gives it back to the shelf. */
  turn_to_cover(): void {
    if (!this.spin_box || (this.album_spin_state !== "showing_back" && this.album_spin_state !== "turning_to_back")) {
      return;
    }
    this.album_spin_state = "turning_to_cover";
    this.spin_box.classList.remove("shelf_album_spin_box_turned");
    clearTimeout(this.spin_timer);
    this.spin_timer = setTimeout(() => this.put_album_back_at_once(), ALBUM_SPIN_DURATION_MS);
  }

  /** Removes the turned album without a turn, for example when the shelf hides. */
  put_album_back_at_once(): void {
    clearTimeout(this.spin_timer);
    if (!this.spin_stage) {
      return;
    }
    this.spin_stage.remove();
    this.spin_stage = null;
    this.spin_box = null;
    this.track_rows_by_spotify_track_id.clear();
    this.album_spin_state = "showing_cover";
    this.update_spin_button();
    this.options.on_spinning_album_change(null);
  }

  private update_spin_button(): void {
    const settled_open_album = this.settled_open_album;
    this.spin_button.hidden = !settled_open_album || this.spin_stage !== null;
    if (settled_open_album) {
      this.spin_button.style.left = `${settled_open_album.cover_left_x + SPIN_BUTTON_INSET}px`;
      this.spin_button.style.top = `${settled_open_album.cover_top_y + SPIN_BUTTON_INSET}px`;
    }
  }

  private async turn_to_back(): Promise<void> {
    const settled_open_album = this.settled_open_album;
    if (!settled_open_album || this.spin_stage) {
      return;
    }
    const { saved_album, cover_size } = settled_open_album;
    const album_tracks = this.options.load_album_tracks(saved_album);
    // The cover is drawn before the shelf hides its own, so the swap does not show.
    const cover_bitmap = await this.options
      .load_cover_bitmap(saved_album, Math.round(cover_size * window.devicePixelRatio))
      .catch(() => null);
    if (this.settled_open_album !== settled_open_album || this.spin_stage) {
      return;
    }
    this.build_spin_stage(settled_open_album, cover_bitmap);
    cover_bitmap?.close();
    this.album_spin_state = "turning_to_back";
    this.update_spin_button();
    this.options.on_spinning_album_change(saved_album);
    // One frame at the cover first, so the browser animates the turn instead of jumping to the back.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (this.album_spin_state === "turning_to_back") {
          this.spin_box?.classList.add("shelf_album_spin_box_turned");
        }
      }),
    );
    clearTimeout(this.spin_timer);
    this.spin_timer = setTimeout(() => {
      if (this.album_spin_state === "turning_to_back") {
        this.album_spin_state = "showing_back";
        this.start_album_name_scroll();
      }
    }, ALBUM_SPIN_DURATION_MS);
    void this.show_album_tracks(settled_open_album, album_tracks);
  }

  private build_spin_stage(settled_open_album: SettledOpenAlbum, cover_bitmap: ImageBitmap | null): void {
    const { saved_album, cover_left_x, cover_top_y, cover_size, spine_width, spine_label_font_size } =
      settled_open_album;
    const spine_colour = saved_album.cover_dominant_colour ?? FALLBACK_SPINE_COLOUR;
    const label_colour = `#${choose_spine_label_colour(parse_hex_colour(spine_colour)).toString(16).padStart(6, "0")}`;

    const spin_stage = document.createElement("div");
    spin_stage.className = "shelf_album_spin_stage";
    spin_stage.style.left = `${cover_left_x}px`;
    spin_stage.style.top = `${cover_top_y}px`;
    spin_stage.style.setProperty("--album_spin_cover_size", `${cover_size}px`);
    spin_stage.style.setProperty("--album_spin_depth", `${spine_width}px`);
    spin_stage.style.setProperty("--album_spin_duration", `${ALBUM_SPIN_DURATION_MS}ms`);
    spin_stage.style.setProperty("--album_spin_spine_colour", spine_colour);
    spin_stage.style.setProperty("--album_spin_label_colour", label_colour);
    spin_stage.style.setProperty(
      "--album_spin_case_colour",
      `#${JEWEL_CASE_BACK_COLOUR.toString(16).padStart(6, "0")}`,
    );
    spin_stage.style.setProperty("--album_spin_cap_height", `${Math.round(cover_size * JEWEL_CASE_CAP_HEIGHT_RATIO)}px`);
    spin_stage.style.setProperty("--album_spin_spine_label_font_size", `${spine_label_font_size}px`);
    spin_stage.addEventListener(
      "wheel",
      (wheel_event) => {
        // A sideways scroll puts the album back at once, so the scrolls after it move the shelf.
        // A vertical scroll is left to the track list.
        if (Math.abs(wheel_event.deltaX) > Math.abs(wheel_event.deltaY)) {
          wheel_event.preventDefault();
          this.put_album_back_at_once();
        }
      },
      { passive: false },
    );

    const spin_box = document.createElement("div");
    spin_box.className = "shelf_album_spin_box";

    const front_face = document.createElement("div");
    front_face.className = "shelf_album_spin_face shelf_album_spin_front_face";
    front_face.appendChild(create_cover_canvas(cover_bitmap, cover_size));

    const spine_face = document.createElement("div");
    spine_face.className = "shelf_album_spin_face shelf_album_spin_spine_face";
    const spine_label = document.createElement("div");
    spine_label.className = "shelf_album_spin_spine_label";
    const spine_artist = document.createElement("span");
    spine_artist.className = "shelf_album_spin_spine_artist";
    spine_artist.textContent = saved_album.artist_names;
    const spine_album_name = document.createElement("span");
    spine_album_name.className = "shelf_album_spin_spine_album_name";
    spine_album_name.textContent = saved_album.album_name;
    spine_label.append(spine_artist, spine_album_name);
    spine_face.appendChild(spine_label);

    const edge_face = document.createElement("div");
    edge_face.className = "shelf_album_spin_face shelf_album_spin_edge_face";

    const back_face = document.createElement("div");
    back_face.className = "shelf_album_spin_face shelf_album_spin_back_face";
    const back_header = document.createElement("div");
    back_header.className = "shelf_album_back_header";
    const back_thumbnail = document.createElement("button");
    back_thumbnail.type = "button";
    back_thumbnail.className = "shelf_album_back_thumbnail";
    back_thumbnail.title = "Turn back to the cover";
    back_thumbnail.setAttribute("aria-label", "Turn back to the cover");
    back_thumbnail.appendChild(
      create_cover_canvas(cover_bitmap, cover_size * ALBUM_BACK_THUMBNAIL_SIZE_TO_COVER_SIZE_RATIO),
    );
    back_thumbnail.addEventListener("click", () => this.turn_to_cover());
    const back_titles = document.createElement("div");
    back_titles.className = "shelf_album_back_titles";
    const back_artist = document.createElement("div");
    back_artist.className = "shelf_album_back_artist";
    back_artist.textContent = saved_album.artist_names;
    const back_album_name = document.createElement("div");
    back_album_name.className = "shelf_album_back_album_name";
    const back_album_name_text = document.createElement("span");
    back_album_name_text.className = "shelf_album_back_album_name_text";
    back_album_name_text.textContent = saved_album.album_name;
    back_album_name.appendChild(back_album_name_text);
    back_titles.append(back_album_name, back_artist);
    back_header.append(back_thumbnail, back_titles);
    const track_list = document.createElement("div");
    track_list.className = "shelf_album_back_track_list";
    const track_list_message = document.createElement("p");
    track_list_message.className = "shelf_album_back_track_list_message";
    track_list_message.textContent = "Loading tracks…";
    track_list.appendChild(track_list_message);
    // The turn button sits in the same spot as the spin button on the front.
    const back_turn_button = document.createElement("button");
    back_turn_button.type = "button";
    back_turn_button.className = "shelf_album_back_turn_button";
    back_turn_button.title = "Turn back to the cover";
    back_turn_button.setAttribute("aria-label", "Turn back to the cover");
    back_turn_button.textContent = "↻";
    back_turn_button.addEventListener("click", () => this.turn_to_cover());
    back_face.append(back_header, track_list, back_turn_button);

    spin_box.append(front_face, spine_face, edge_face, back_face);
    spin_stage.appendChild(spin_box);
    this.options.host_element.appendChild(spin_stage);
    this.spin_stage = spin_stage;
    this.spin_box = spin_box;
  }

  /**
   * Scrolls an album name too long for the back to show its end, rests, and scrolls back, then repeats.
   * Each end fades out while text is hidden past it. The animation ends with the stage.
   */
  private start_album_name_scroll(): void {
    const album_name = this.spin_stage?.querySelector<HTMLElement>(".shelf_album_back_album_name");
    const album_name_text = album_name?.querySelector<HTMLElement>(".shelf_album_back_album_name_text");
    if (!album_name || !album_name_text) {
      return;
    }
    const overflow_width = album_name.scrollWidth - album_name.clientWidth;
    if (overflow_width <= 0) {
      return;
    }
    album_name.classList.add("shelf_album_back_album_name_scrolling");
    const scroll_duration_ms = (overflow_width / ALBUM_NAME_SCROLL_SPEED_PX_PER_S) * 1000;
    const cycle_duration_ms = ALBUM_NAME_REST_AT_START_MS + 2 * scroll_duration_ms + ALBUM_NAME_REST_AT_END_MS;
    const scroll_start_offset = ALBUM_NAME_REST_AT_START_MS / cycle_duration_ms;
    const scroll_end_offset = (ALBUM_NAME_REST_AT_START_MS + scroll_duration_ms) / cycle_duration_ms;
    const scroll_back_offset =
      (ALBUM_NAME_REST_AT_START_MS + scroll_duration_ms + ALBUM_NAME_REST_AT_END_MS) / cycle_duration_ms;
    const timing: KeyframeAnimationOptions = {
      duration: cycle_duration_ms,
      iterations: Infinity,
      // A negative delay shortens the first rest at the start.
      delay: ALBUM_NAME_FIRST_SCROLL_DELAY_MS - ALBUM_NAME_REST_AT_START_MS,
    };
    const at_start = "translateX(0)";
    const at_end = `translateX(${-overflow_width}px)`;
    album_name_text.animate(
      [
        { transform: at_start, offset: 0 },
        { transform: at_start, offset: scroll_start_offset, easing: "ease-in-out" },
        { transform: at_end, offset: scroll_end_offset },
        { transform: at_end, offset: scroll_back_offset, easing: "ease-in-out" },
        { transform: at_start, offset: 1 },
      ],
      timing,
    );
    // At the start only the right end fades; at the end only the left end fades.
    const fades_at_start = {
      "--album_back_album_name_left_fade": "0px",
      "--album_back_album_name_right_fade": ALBUM_NAME_FADE_WIDTH,
    };
    const fades_at_end = {
      "--album_back_album_name_left_fade": ALBUM_NAME_FADE_WIDTH,
      "--album_back_album_name_right_fade": "0px",
    };
    album_name.animate(
      [
        { ...fades_at_start, offset: 0 },
        { ...fades_at_start, offset: scroll_start_offset, easing: "ease-in-out" },
        { ...fades_at_end, offset: scroll_end_offset },
        { ...fades_at_end, offset: scroll_back_offset, easing: "ease-in-out" },
        { ...fades_at_start, offset: 1 },
      ],
      timing,
    );
  }

  private async show_album_tracks(
    settled_open_album: SettledOpenAlbum,
    album_tracks_promise: Promise<AlbumTrack[]>,
  ): Promise<void> {
    const spin_stage = this.spin_stage;
    const track_list = spin_stage?.querySelector<HTMLElement>(".shelf_album_back_track_list");
    if (!spin_stage || !track_list) {
      return;
    }
    let album_tracks: AlbumTrack[];
    try {
      album_tracks = await album_tracks_promise;
    } catch (load_error) {
      console.warn("Shelf could not read the album's tracks", load_error);
      if (this.spin_stage === spin_stage) {
        track_list.querySelector(".shelf_album_back_track_list_message")!.textContent =
          "Shelf could not read the tracks.";
      }
      return;
    }
    if (this.spin_stage !== spin_stage) {
      return;
    }
    // styles.css sets the list's height from the cover size, so it is measured here, not computed again.
    const { row_height, type_scale } = compute_album_back_track_row_layout(
      album_tracks.length,
      track_list.clientHeight,
    );
    track_list.style.setProperty("--album_back_track_row_height", `${row_height}px`);
    track_list.style.setProperty("--album_back_track_type_scale", String(type_scale));
    track_list.replaceChildren(
      ...album_tracks.map((album_track, track_index) => {
        const track_row = document.createElement("button");
        track_row.type = "button";
        track_row.className = "shelf_album_back_track_row";
        track_row.title = `Play ${album_track.track_name}`;
        const track_number = document.createElement("span");
        track_number.className = "shelf_album_back_track_number";
        track_number.textContent = `${track_index + 1}.`;
        const track_name = document.createElement("span");
        track_name.className = "shelf_album_back_track_name";
        track_name.textContent = album_track.track_name;
        const track_duration = document.createElement("span");
        track_duration.className = "shelf_album_back_track_duration";
        track_duration.textContent = format_album_track_duration(album_track.duration_ms);
        track_row.append(track_number, track_name, track_duration);
        track_row.addEventListener("click", () =>
          this.options.on_track_click(settled_open_album.saved_album, album_track),
        );
        this.track_rows_by_spotify_track_id.set(album_track.spotify_track_id, track_row);
        return track_row;
      }),
    );
    this.set_now_playing_track(this.now_playing_spotify_track_id);
    // A list that scrolls fades out its last visible row, until it reaches its end.
    const update_track_list_fade = () =>
      track_list.classList.toggle(
        "shelf_album_back_track_list_more_below",
        track_list.scrollTop + track_list.clientHeight < track_list.scrollHeight - 1,
      );
    track_list.addEventListener("scroll", update_track_list_fade);
    update_track_list_fade();
  }
}

/** A canvas showing the cover at `size` CSS pixels square, or the spine colour when there is no cover. */
function create_cover_canvas(cover_bitmap: ImageBitmap | null, size: number): HTMLCanvasElement {
  const cover_canvas = document.createElement("canvas");
  cover_canvas.className = "shelf_album_spin_cover_canvas";
  cover_canvas.width = cover_canvas.height = Math.round(size * window.devicePixelRatio);
  if (cover_bitmap) {
    cover_canvas.getContext("2d")!.drawImage(cover_bitmap, 0, 0, cover_canvas.width, cover_canvas.height);
  }
  return cover_canvas;
}
