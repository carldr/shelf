import {
  Application,
  BitmapFont,
  BitmapText,
  Cache,
  Container,
  Graphics,
  Sprite,
  Texture,
  UPDATE_PRIORITY,
} from "pixi.js";
import type { SavedAlbum } from "../library/saved_album";
import { ShelfCoverTextureCache } from "./shelf_cover_texture_cache";
import {
  compute_album_rect_x,
  compute_scroll_x_centring_album,
  compute_scroll_x_range,
  ease_toward,
  find_closed_album_index_at,
  find_drawn_album_index_at,
  type OpeningAlbum,
  type ShelfGeometry,
} from "./shelf_layout";
import { choose_spine_label_colour, fit_spine_label_texts, parse_hex_colour } from "./shelf_spine_label";

const SHELF_TOP_PADDING = 6;
const SHELF_LEDGE_HEIGHT = 8;
const SHELF_EDGE_PADDING = 12;
/** A CD jewel case spine is 10.4 mm wide and 125 mm tall. */
const SPINE_WIDTH_TO_COVER_SIZE_RATIO = 10.4 / 125;

/** Label type size as a share of spine width. */
const SPINE_LABEL_FONT_SIZE_TO_SPINE_WIDTH_RATIO = 0.36;
const SPINE_LABEL_PADDING_ALONG_SPINE = 10;
/** The gap between artist and album name, as a share of the type size. */
const SPINE_LABEL_GAP_TO_FONT_SIZE_RATIO = 0.6;

/** The hinge caps at each end of a jewel case, as a share of its height. */
const JEWEL_CASE_CAP_HEIGHT_RATIO = 0.035;
/** The clear plastic rail on each side of the insert, as a share of the spine width. */
const JEWEL_CASE_RAIL_WIDTH_RATIO = 0.06;
const JEWEL_CASE_BACK_COLOUR = 0x1c1c1f;

/** Spotify green. */
const NOW_PLAYING_MARKER_COLOUR = 0x1ed760;
const NOW_PLAYING_MARKER_HEIGHT = 4;
const SPINE_LABEL_FONT_FAMILY = "-apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif";
const SPINE_LABEL_ARTIST_FONT_NAME = "shelf_spine_label_artist_font";
const SPINE_LABEL_ALBUM_NAME_FONT_NAME = "shelf_spine_label_album_name_font";

const SCROLL_EASING_TIME_CONSTANT_MS = 45;
const OPEN_AMOUNT_EASING_TIME_CONSTANT_MS = 80;
/** An album whose open amount falls below this is closed and leaves the opening list. */
const CLOSED_OPEN_AMOUNT_THRESHOLD = 0.002;
/** The shelf snaps to the nearest album once no wheel event has arrived for this long. */
const WHEEL_SNAP_DELAY_MS = 120;
/** Lines from a mouse wheel in line mode become this many pixels. */
const WHEEL_LINE_HEIGHT_PX = 16;
/** A closed cover is drawn this bright, so that a turning case looks lit from the front. */
const TURNING_COVER_MINIMUM_BRIGHTNESS = 0.55;

export interface ShelfRendererOptions {
  host_element: HTMLElement;
  /** Produces the album's cover at `size_px` square, or null when it has none. */
  load_cover_bitmap: (saved_album: SavedAlbum, size_px: number) => Promise<ImageBitmap | null>;
  on_album_click: (saved_album: SavedAlbum) => void;
  /** Receives the duration of each frame, for the performance overlay. */
  on_frame?: (shelf_frame_timing: ShelfFrameTiming) => void;
  /** Dev-only switches that leave out parts of the drawing, to find what limits the frame rate. */
  stress_test_switches?: { without_covers: boolean; without_jewel_case: boolean };
}

export interface ShelfFrameTiming {
  /** Time since the previous frame. */
  frame_duration_ms: number;
  /** Time spent laying out the shelf in this frame. */
  layout_ms: number;
  /** Time spent in Pixi's render call, which issues the WebGL commands. */
  render_ms: number;
}

interface SpineLabelTexts {
  artist_text: string;
  album_name_text: string;
}

/**
 * The Pixi objects of one visible album. They are pooled and reused as albums scroll in and out.
 * From back to front: the dark case, the coloured paper insert, the label printed on it,
 * the clear plastic of the case, and the cover that turns into view as the album opens.
 */
class ShelfAlbumDisplay {
  readonly container = new Container();
  readonly case_back = new Sprite(Texture.WHITE);
  readonly spine_insert = new Sprite(Texture.WHITE);
  readonly spine_label = new Container();
  readonly artist_text: BitmapText;
  readonly album_name_text: BitmapText;
  readonly jewel_case_overlay: Sprite;
  readonly cover_face = new Sprite(Texture.WHITE);
  spine_colour = 0x808080;

  constructor(
    jewel_case_overlay_texture: Texture,
    private readonly spine_label_font_size: number,
  ) {
    this.case_back.tint = JEWEL_CASE_BACK_COLOUR;
    this.artist_text = new BitmapText({
      text: "",
      style: { fontFamily: SPINE_LABEL_ARTIST_FONT_NAME, fontSize: spine_label_font_size },
    });
    this.album_name_text = new BitmapText({
      text: "",
      style: { fontFamily: SPINE_LABEL_ALBUM_NAME_FONT_NAME, fontSize: spine_label_font_size },
    });
    this.jewel_case_overlay = new Sprite(jewel_case_overlay_texture);
    // Rotated a quarter turn clockwise, so the label reads from top to bottom as on UK CD spines.
    this.spine_label.rotation = Math.PI / 2;
    this.spine_label.addChild(this.artist_text, this.album_name_text);
    this.container.addChild(
      this.case_back,
      this.spine_insert,
      this.spine_label,
      this.jewel_case_overlay,
      this.cover_face,
    );
  }

  show_album(saved_album: SavedAlbum, spine_label_texts: SpineLabelTexts): void {
    this.spine_colour = saved_album.cover_dominant_colour ? parse_hex_colour(saved_album.cover_dominant_colour) : 0x808080;
    this.spine_insert.tint = this.spine_colour;
    const label_colour = choose_spine_label_colour(this.spine_colour);
    this.artist_text.text = spine_label_texts.artist_text;
    this.album_name_text.text = spine_label_texts.album_name_text;
    this.artist_text.tint = label_colour;
    this.album_name_text.tint = label_colour;
    this.album_name_text.alpha = 0.85;
    this.album_name_text.x =
      this.artist_text.width + this.spine_label_font_size * SPINE_LABEL_GAP_TO_FONT_SIZE_RATIO;
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}

/**
 * Draws the saved albums as a horizontally scrolling shelf of CD spines with PixiJS.
 * Only albums within the viewport, plus a margin, have display objects, so the cost of a
 * frame depends on the window width and not on the size of the library.
 */
export class ShelfRenderer {
  private readonly application = new Application();
  private readonly shelf_content = new Container();
  private readonly shelf_ledge = new Graphics();
  /** A green bar on the ledge under the album Spotify is playing. */
  private readonly now_playing_marker = new Sprite(Texture.WHITE);
  private now_playing_album_index = -1;
  private album_indexes_by_spotify_album_id = new Map<string, number>();
  private readonly cover_texture_cache = new ShelfCoverTextureCache();
  private readonly displays_by_album_index = new Map<number, ShelfAlbumDisplay>();
  private readonly unused_displays: ShelfAlbumDisplay[] = [];
  private readonly open_amounts_by_album_index = new Map<number, number>();
  private jewel_case_overlay_texture: Texture = Texture.WHITE;
  private spine_label_font_size = 11;
  private spine_label_texts_by_album_index: (SpineLabelTexts | undefined)[] = [];
  private saved_albums: readonly SavedAlbum[] = [];
  private shelf_geometry: ShelfGeometry = { spine_width: 24, cover_size: 200, edge_padding: SHELF_EDGE_PADDING };
  private scroll_x = 0;
  private scroll_target_x = 0;
  private snap_timer: ReturnType<typeof setTimeout> | undefined;
  private focused_album_index = -1;
  private layout_start_ms = 0;
  private layout_end_ms = 0;
  /** The last frame's layout, for hit testing clicks against what is on screen. */
  private drawn_opening_albums: OpeningAlbum[] = [];
  private drawn_album_index_range = { first_album_index: 0, last_album_index: -1 };
  private readonly label_measuring_context = document.createElement("canvas").getContext("2d")!;

  private constructor(private readonly options: ShelfRendererOptions) {}

  static async create(options: ShelfRendererOptions): Promise<ShelfRenderer> {
    const shelf_renderer = new ShelfRenderer(options);
    await shelf_renderer.initialise();
    return shelf_renderer;
  }

  private async initialise(): Promise<void> {
    await this.application.init({
      resizeTo: this.options.host_element,
      backgroundAlpha: 0,
      antialias: true,
      resolution: window.devicePixelRatio,
      autoDensity: true,
      preference: "webgl",
    });
    this.options.host_element.appendChild(this.application.canvas);
    this.now_playing_marker.tint = NOW_PLAYING_MARKER_COLOUR;
    this.now_playing_marker.visible = false;
    this.application.stage.addChild(this.shelf_ledge, this.shelf_content, this.now_playing_marker);

    this.application.renderer.on("resize", () => this.update_geometry());
    this.update_geometry();
    this.listen_to_click_and_wheel();
    this.application.ticker.add((ticker) => this.render_frame(ticker.deltaMS));
    if (this.options.on_frame) {
      // Pixi renders at LOW priority, after the layout; this runs after the render.
      this.application.ticker.add(
        (ticker) => {
          const render_end_ms = performance.now();
          this.options.on_frame?.({
            frame_duration_ms: ticker.deltaMS,
            layout_ms: this.layout_end_ms - this.layout_start_ms,
            render_ms: render_end_ms - this.layout_end_ms,
          });
        },
        undefined,
        UPDATE_PRIORITY.UTILITY,
      );
    }
  }

  set_albums(saved_albums: readonly SavedAlbum[]): void {
    const now_playing_spotify_album_id = this.saved_albums[this.now_playing_album_index]?.spotify_album_id ?? null;
    this.saved_albums = saved_albums;
    this.album_indexes_by_spotify_album_id = new Map(
      saved_albums.map((saved_album, album_index) => [saved_album.spotify_album_id, album_index]),
    );
    this.set_now_playing_album(now_playing_spotify_album_id);
    this.spine_label_texts_by_album_index = [];
    this.open_amounts_by_album_index.clear();
    for (const [album_index, display] of this.displays_by_album_index) {
      this.release_display(album_index, display);
    }
    this.scroll_target_x = compute_scroll_x_centring_album(0, this.application.screen.width, this.shelf_geometry);
    this.scroll_x = this.scroll_target_x;
  }

  /** Marks the album Spotify is playing, or clears the mark for null or an album not in the library. */
  set_now_playing_album(spotify_album_id: string | null): void {
    this.now_playing_album_index = spotify_album_id
      ? (this.album_indexes_by_spotify_album_id.get(spotify_album_id) ?? -1)
      : -1;
  }

  /** Puts the album in the middle without scrolling to it. Returns false if it is not in the library. */
  jump_to_album(spotify_album_id: string): boolean {
    const album_index = this.album_indexes_by_spotify_album_id.get(spotify_album_id);
    if (album_index === undefined) {
      return false;
    }
    this.scroll_album_to_centre(album_index);
    this.scroll_x = this.scroll_target_x;
    // Open it at once, so the shelf appears with the album already out.
    this.open_amounts_by_album_index.clear();
    this.open_amounts_by_album_index.set(album_index, 1);
    return true;
  }

  /** Scrolls, with easing, so that `scroll_target_x` is the left edge of the view. */
  scroll_to(scroll_target_x: number): void {
    this.scroll_target_x = scroll_target_x;
    this.clamp_scroll_target();
  }

  scroll_album_to_centre(album_index: number): void {
    this.scroll_to(compute_scroll_x_centring_album(album_index, this.application.screen.width, this.shelf_geometry));
  }

  get scroll_x_range(): { minimum_scroll_x: number; maximum_scroll_x: number } {
    return compute_scroll_x_range(this.saved_albums.length, this.application.screen.width, this.shelf_geometry);
  }

  /** Stops drawing while the window is hidden. */
  pause(): void {
    this.application.ticker.stop();
  }

  resume(): void {
    this.application.ticker.start();
  }

  destroy(): void {
    this.cover_texture_cache.destroy();
    this.application.destroy(true, { children: true });
  }

  private update_geometry(): void {
    const centred_album_index = Math.max(this.focused_album_index, 0);
    const view_height = this.application.screen.height;
    const cover_size = Math.max(40, Math.floor(view_height - SHELF_TOP_PADDING - SHELF_LEDGE_HEIGHT));
    this.shelf_geometry = {
      spine_width: Math.round(cover_size * SPINE_WIDTH_TO_COVER_SIZE_RATIO),
      cover_size,
      edge_padding: SHELF_EDGE_PADDING,
    };
    this.cover_texture_cache.set_texture_size_px(Math.round(cover_size * window.devicePixelRatio));
    this.spine_label_texts_by_album_index = [];
    for (const [album_index, display] of this.displays_by_album_index) {
      this.release_display(album_index, display);
    }
    // Pooled displays hold the old type size and case texture, so they are rebuilt at the new size.
    for (const unused_display of this.unused_displays.splice(0)) {
      unused_display.destroy();
    }
    this.spine_label_font_size = Math.round(this.shelf_geometry.spine_width * SPINE_LABEL_FONT_SIZE_TO_SPINE_WIDTH_RATIO);
    install_spine_label_fonts(this.spine_label_font_size);
    const previous_jewel_case_overlay_texture = this.jewel_case_overlay_texture;
    this.jewel_case_overlay_texture = create_jewel_case_overlay_texture(this.shelf_geometry);
    if (previous_jewel_case_overlay_texture !== Texture.WHITE) {
      previous_jewel_case_overlay_texture.destroy(true);
    }
    this.shelf_ledge
      .clear()
      .rect(0, SHELF_TOP_PADDING + cover_size, this.application.screen.width, 2)
      .fill({ color: 0xffffff, alpha: 0.18 })
      .rect(0, SHELF_TOP_PADDING + cover_size + 2, this.application.screen.width, SHELF_LEDGE_HEIGHT - 2)
      .fill({ color: 0x000000, alpha: 0.25 });
    // Keep the same album in the middle at the new size.
    this.scroll_target_x = compute_scroll_x_centring_album(
      centred_album_index,
      this.application.screen.width,
      this.shelf_geometry,
    );
    this.scroll_x = this.scroll_target_x;
  }

  /**
   * The pointer does not move focus: the open album is always the one in the middle.
   * Clicking it plays it; clicking another album brings that album to the middle.
   */
  private listen_to_click_and_wheel(): void {
    const canvas = this.application.canvas;
    canvas.addEventListener("click", (click_event) => {
      const clicked_album_index = find_drawn_album_index_at(
        this.scroll_x + click_event.offsetX,
        this.drawn_album_index_range.first_album_index,
        this.drawn_album_index_range.last_album_index,
        this.drawn_opening_albums,
        this.shelf_geometry,
      );
      if (clicked_album_index === -1) {
        return;
      }
      if (clicked_album_index === this.focused_album_index) {
        this.options.on_album_click(this.saved_albums[clicked_album_index]);
      } else {
        this.scroll_album_to_centre(clicked_album_index);
      }
    });
    canvas.addEventListener(
      "wheel",
      (wheel_event) => {
        wheel_event.preventDefault();
        const line_scale = wheel_event.deltaMode === WheelEvent.DOM_DELTA_LINE ? WHEEL_LINE_HEIGHT_PX : 1;
        // A vertical mouse wheel scrolls the shelf sideways too.
        const wheel_delta =
          Math.abs(wheel_event.deltaX) > Math.abs(wheel_event.deltaY) ? wheel_event.deltaX : wheel_event.deltaY;
        this.scroll_to(this.scroll_target_x + wheel_delta * line_scale);
        // Trackpad momentum arrives as more wheel events, so snap only once they stop.
        clearTimeout(this.snap_timer);
        this.snap_timer = setTimeout(() => this.snap_to_nearest_album(), WHEEL_SNAP_DELAY_MS);
      },
      { passive: false },
    );
  }

  /** Settles the scroll so that the album nearest the middle is exactly in the middle. */
  private snap_to_nearest_album(): void {
    if (this.saved_albums.length === 0) {
      return;
    }
    const view_width = this.application.screen.width;
    this.scroll_album_to_centre(
      find_closed_album_index_at(this.scroll_target_x + view_width / 2, this.saved_albums.length, this.shelf_geometry),
    );
  }

  private clamp_scroll_target(): void {
    const { minimum_scroll_x, maximum_scroll_x } = this.scroll_x_range;
    this.scroll_target_x = Math.min(Math.max(this.scroll_target_x, minimum_scroll_x), maximum_scroll_x);
  }

  private render_frame(frame_duration_ms: number): void {
    this.layout_start_ms = performance.now();
    this.lay_out_frame(frame_duration_ms);
    this.layout_end_ms = performance.now();
  }

  private lay_out_frame(frame_duration_ms: number): void {
    this.cover_texture_cache.begin_frame();
    const album_count = this.saved_albums.length;
    if (album_count === 0) {
      return;
    }
    const view_width = this.application.screen.width;
    this.scroll_x = ease_toward(this.scroll_x, this.scroll_target_x, frame_duration_ms, SCROLL_EASING_TIME_CONSTANT_MS);
    if (Math.abs(this.scroll_x - this.scroll_target_x) < 0.1) {
      this.scroll_x = this.scroll_target_x;
    }

    this.focused_album_index = find_closed_album_index_at(
      this.scroll_x + view_width / 2,
      album_count,
      this.shelf_geometry,
    );
    const opening_albums = this.update_open_amounts(frame_duration_ms);

    // Opening albums push neighbours at most half a cover each way, so a margin of one cover covers them.
    const margin_x = this.shelf_geometry.cover_size;
    const first_visible_index = find_closed_album_index_at(this.scroll_x - margin_x, album_count, this.shelf_geometry);
    const last_visible_index = find_closed_album_index_at(
      this.scroll_x + view_width + margin_x,
      album_count,
      this.shelf_geometry,
    );

    for (const [album_index, display] of this.displays_by_album_index) {
      if (album_index < first_visible_index || album_index > last_visible_index) {
        this.release_display(album_index, display);
      }
    }
    for (let album_index = first_visible_index; album_index <= last_visible_index; album_index += 1) {
      const display = this.displays_by_album_index.get(album_index) ?? this.acquire_display(album_index);
      this.position_display(display, album_index, opening_albums);
    }
    this.drawn_opening_albums = opening_albums;
    this.drawn_album_index_range = { first_album_index: first_visible_index, last_album_index: last_visible_index };
    this.position_now_playing_marker(opening_albums);
  }

  private position_now_playing_marker(opening_albums: OpeningAlbum[]): void {
    this.now_playing_marker.visible = this.displays_by_album_index.has(this.now_playing_album_index);
    if (!this.now_playing_marker.visible) {
      return;
    }
    const album_rect = compute_album_rect_x(this.now_playing_album_index, opening_albums, this.shelf_geometry);
    this.now_playing_marker.x = album_rect.left_x - this.scroll_x;
    this.now_playing_marker.y = SHELF_TOP_PADDING + this.shelf_geometry.cover_size;
    this.now_playing_marker.width = album_rect.width;
    this.now_playing_marker.height = NOW_PLAYING_MARKER_HEIGHT;
  }

  private update_open_amounts(frame_duration_ms: number): OpeningAlbum[] {
    if (!this.open_amounts_by_album_index.has(this.focused_album_index)) {
      this.open_amounts_by_album_index.set(this.focused_album_index, 0);
    }
    const opening_albums: OpeningAlbum[] = [];
    for (const [album_index, open_amount] of this.open_amounts_by_album_index) {
      const target_open_amount = album_index === this.focused_album_index ? 1 : 0;
      const next_open_amount = ease_toward(
        open_amount,
        target_open_amount,
        frame_duration_ms,
        OPEN_AMOUNT_EASING_TIME_CONSTANT_MS,
      );
      if (target_open_amount === 0 && next_open_amount < CLOSED_OPEN_AMOUNT_THRESHOLD) {
        this.open_amounts_by_album_index.delete(album_index);
        continue;
      }
      this.open_amounts_by_album_index.set(album_index, next_open_amount);
      opening_albums.push({ album_index, open_amount: next_open_amount });
    }
    return opening_albums;
  }

  private position_display(display: ShelfAlbumDisplay, album_index: number, opening_albums: OpeningAlbum[]): void {
    const { spine_width, cover_size } = this.shelf_geometry;
    const open_amount = this.open_amounts_by_album_index.get(album_index) ?? 0;
    const album_rect = compute_album_rect_x(album_index, opening_albums, this.shelf_geometry);
    const left_x = album_rect.left_x - this.scroll_x;

    // A turning case: the spine narrows as the cover widens, and together they fill the album's width.
    const drawn_spine_width = spine_width * (1 - open_amount);
    const drawn_cover_width = cover_size * open_amount;

    display.container.x = left_x;
    display.container.y = SHELF_TOP_PADDING;
    display.case_back.width = drawn_spine_width;
    display.case_back.height = cover_size;
    const drawn_rail_width = spine_width * JEWEL_CASE_RAIL_WIDTH_RATIO * (1 - open_amount);
    display.spine_insert.x = drawn_rail_width;
    display.spine_insert.width = drawn_spine_width - 2 * drawn_rail_width;
    display.spine_insert.height = cover_size;
    display.jewel_case_overlay.width = drawn_spine_width;
    display.jewel_case_overlay.height = cover_size;
    display.jewel_case_overlay.visible = !this.options.stress_test_switches?.without_jewel_case;

    display.spine_label.visible = open_amount < 0.6;
    display.spine_label.scale.y = 1 - open_amount;
    display.spine_label.x = drawn_spine_width / 2 + (display.artist_text.height / 2) * (1 - open_amount);
    display.spine_label.y = this.spine_label_start_y();

    display.cover_face.visible = open_amount > CLOSED_OPEN_AMOUNT_THRESHOLD;
    if (display.cover_face.visible) {
      const saved_album = this.saved_albums[album_index];
      const cover_texture = this.options.stress_test_switches?.without_covers
        ? null
        : this.cover_texture_cache.get_or_start_loading(saved_album.spotify_album_id, (size_px) =>
            this.options.load_cover_bitmap(saved_album, size_px),
          );
      display.cover_face.texture = cover_texture ?? Texture.WHITE;
      display.cover_face.x = drawn_spine_width;
      display.cover_face.width = drawn_cover_width;
      display.cover_face.height = cover_size;
      const brightness = TURNING_COVER_MINIMUM_BRIGHTNESS + (1 - TURNING_COVER_MINIMUM_BRIGHTNESS) * open_amount;
      display.cover_face.tint = cover_texture ? scale_colour_brightness(0xffffff, brightness) : display.spine_colour;
    }
  }

  private acquire_display(album_index: number): ShelfAlbumDisplay {
    const display =
      this.unused_displays.pop() ?? new ShelfAlbumDisplay(this.jewel_case_overlay_texture, this.spine_label_font_size);
    display.show_album(this.saved_albums[album_index], this.spine_label_texts(album_index));
    this.shelf_content.addChild(display.container);
    this.displays_by_album_index.set(album_index, display);
    return display;
  }

  private release_display(album_index: number, display: ShelfAlbumDisplay): void {
    this.shelf_content.removeChild(display.container);
    this.displays_by_album_index.delete(album_index);
    this.unused_displays.push(display);
  }

  /** The label starts below the top hinge cap of the case. */
  private spine_label_start_y(): number {
    return this.shelf_geometry.cover_size * JEWEL_CASE_CAP_HEIGHT_RATIO + SPINE_LABEL_PADDING_ALONG_SPINE;
  }

  private spine_label_texts(album_index: number): SpineLabelTexts {
    let spine_label_texts = this.spine_label_texts_by_album_index[album_index];
    if (!spine_label_texts) {
      const measure_with_font = (font_weight: string) => (text: string) => {
        this.label_measuring_context.font = `${font_weight} ${this.spine_label_font_size}px ${SPINE_LABEL_FONT_FAMILY}`;
        return this.label_measuring_context.measureText(text).width;
      };
      spine_label_texts = fit_spine_label_texts(
        this.saved_albums[album_index],
        this.shelf_geometry.cover_size - 2 * this.spine_label_start_y(),
        this.spine_label_font_size * SPINE_LABEL_GAP_TO_FONT_SIZE_RATIO,
        measure_with_font("700"),
        measure_with_font("400"),
      );
      this.spine_label_texts_by_album_index[album_index] = spine_label_texts;
    }
    return spine_label_texts;
  }
}

/** Installs the label fonts at `font_size`, replacing any installed at another size. */
function install_spine_label_fonts(font_size: number): void {
  for (const [font_name, font_weight] of [
    [SPINE_LABEL_ARTIST_FONT_NAME, "700"],
    [SPINE_LABEL_ALBUM_NAME_FONT_NAME, "400"],
  ] as const) {
    // Pixi stores installed fonts under "<name>-bitmap"; uninstalling a missing one logs a warning.
    if (Cache.has(`${font_name}-bitmap`)) {
      BitmapFont.uninstall(font_name);
    }
    // White glyphs, tinted per spine. Missing characters, such as Japanese titles, are added on first use.
    BitmapFont.install({
      name: font_name,
      style: { fontFamily: SPINE_LABEL_FONT_FAMILY, fontSize: font_size, fontWeight: font_weight, fill: 0xffffff },
      resolution: window.devicePixelRatio,
      dynamicFill: true,
    });
  }
}

/**
 * The clear plastic of a jewel case seen from the spine, drawn once per spine size at screen
 * resolution: hinge caps with knuckles at both ends, a clear rail down each side of the insert,
 * a light outer left edge, a dark outer right edge, and a glare streak on the plastic.
 */
function create_jewel_case_overlay_texture(shelf_geometry: ShelfGeometry): Texture {
  const pixel_ratio = window.devicePixelRatio;
  const spine_width = shelf_geometry.spine_width;
  const spine_height = shelf_geometry.cover_size;
  const overlay_canvas = document.createElement("canvas");
  overlay_canvas.width = Math.round(spine_width * pixel_ratio);
  overlay_canvas.height = Math.round(spine_height * pixel_ratio);
  const overlay_context = overlay_canvas.getContext("2d")!;
  overlay_context.scale(pixel_ratio, pixel_ratio);

  const cap_height = spine_height * JEWEL_CASE_CAP_HEIGHT_RATIO;
  const rail_width = spine_width * JEWEL_CASE_RAIL_WIDTH_RATIO;

  // Clear rails on each side of the insert.
  overlay_context.fillStyle = "rgba(255,255,255,0.10)";
  overlay_context.fillRect(0, 0, rail_width, spine_height);
  overlay_context.fillRect(spine_width - rail_width, 0, rail_width, spine_height);

  // Glare streak on the plastic, a little in from the left edge.
  const glare_gradient = overlay_context.createLinearGradient(spine_width * 0.12, 0, spine_width * 0.34, 0);
  glare_gradient.addColorStop(0, "rgba(255,255,255,0)");
  glare_gradient.addColorStop(0.5, "rgba(255,255,255,0.16)");
  glare_gradient.addColorStop(1, "rgba(255,255,255,0)");
  overlay_context.fillStyle = glare_gradient;
  overlay_context.fillRect(spine_width * 0.12, cap_height, spine_width * 0.22, spine_height - 2 * cap_height);

  // Hinge caps at both ends, with a knuckle in each and a thin highlight on the inner edge.
  for (const cap_top of [0, spine_height - cap_height]) {
    overlay_context.fillStyle = "rgba(18,18,20,0.82)";
    overlay_context.fillRect(0, cap_top, spine_width, cap_height);
    overlay_context.fillStyle = "rgba(255,255,255,0.16)";
    const inner_edge_y = cap_top === 0 ? cap_height - 1 : cap_top;
    overlay_context.fillRect(0, inner_edge_y, spine_width, 1);
    const knuckle_width = spine_width * 0.5;
    const knuckle_height = cap_height * 0.5;
    overlay_context.beginPath();
    overlay_context.roundRect(
      (spine_width - knuckle_width) / 2,
      cap_top + (cap_height - knuckle_height) / 2,
      knuckle_width,
      knuckle_height,
      knuckle_height / 2,
    );
    overlay_context.fillStyle = "rgba(255,255,255,0.14)";
    overlay_context.fill();
    overlay_context.strokeStyle = "rgba(255,255,255,0.28)";
    overlay_context.lineWidth = 0.5;
    overlay_context.stroke();
  }

  // Outer edges: light on the left, dark on the right, so neighbouring cases read as separate.
  overlay_context.fillStyle = "rgba(255,255,255,0.35)";
  overlay_context.fillRect(0, 0, 1, spine_height);
  overlay_context.fillStyle = "rgba(0,0,0,0.55)";
  overlay_context.fillRect(spine_width - 1, 0, 1, spine_height);

  return Texture.from(overlay_canvas);
}

function scale_colour_brightness(rgb_colour: number, brightness: number): number {
  const scale_channel = (shift: number) => Math.round(((rgb_colour >> shift) & 0xff) * brightness) << shift;
  return scale_channel(16) | scale_channel(8) | scale_channel(0);
}
