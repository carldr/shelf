import { Application, BitmapFont, BitmapText, Container, Graphics, Sprite, Texture } from "pixi.js";
import type { SavedAlbum } from "../library/saved_album";
import { ShelfCoverTextureCache } from "./shelf_cover_texture_cache";
import {
  compute_album_rect_x,
  compute_shelf_content_width,
  ease_toward,
  find_closed_album_index_at,
  type OpeningAlbum,
  type ShelfGeometry,
} from "./shelf_layout";
import { choose_spine_label_colour, fit_spine_label_texts, parse_hex_colour } from "./shelf_spine_label";

const SHELF_TOP_PADDING = 6;
const SHELF_LEDGE_HEIGHT = 8;
const SHELF_EDGE_PADDING = 12;
/** A CD jewel case spine is 10.4 mm wide and 125 mm tall. */
const SPINE_WIDTH_TO_COVER_SIZE_RATIO = 10.4 / 125;

const SPINE_LABEL_FONT_SIZE = 11;
const SPINE_LABEL_PADDING_ALONG_SPINE = 8;
const SPINE_LABEL_GAP_BETWEEN_ARTIST_AND_ALBUM_NAME = 7;
const SPINE_LABEL_FONT_FAMILY = "-apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif";
const SPINE_LABEL_ARTIST_FONT_NAME = "shelf_spine_label_artist_font";
const SPINE_LABEL_ALBUM_NAME_FONT_NAME = "shelf_spine_label_album_name_font";

const SCROLL_EASING_TIME_CONSTANT_MS = 45;
const OPEN_AMOUNT_EASING_TIME_CONSTANT_MS = 80;
/** An album whose open amount falls below this is closed and leaves the opening list. */
const CLOSED_OPEN_AMOUNT_THRESHOLD = 0.002;
/** Lines from a mouse wheel in line mode become this many pixels. */
const WHEEL_LINE_HEIGHT_PX = 16;
/** A closed cover is drawn this bright, so that a turning case looks lit from the front. */
const TURNING_COVER_MINIMUM_BRIGHTNESS = 0.55;

export interface ShelfRendererOptions {
  host_element: HTMLElement;
  cover_url_for_album: (saved_album: SavedAlbum) => string | null;
  on_album_click: (saved_album: SavedAlbum) => void;
  /** Receives the duration of each frame, for the performance overlay. */
  on_frame?: (frame_duration_ms: number) => void;
}

interface SpineLabelTexts {
  artist_text: string;
  album_name_text: string;
}

/** The Pixi objects of one visible album. They are pooled and reused as albums scroll in and out. */
class ShelfAlbumDisplay {
  readonly container = new Container();
  readonly spine_face = new Sprite(Texture.WHITE);
  readonly spine_shading: Sprite;
  readonly spine_label = new Container();
  readonly artist_text = new BitmapText({
    text: "",
    style: { fontFamily: SPINE_LABEL_ARTIST_FONT_NAME, fontSize: SPINE_LABEL_FONT_SIZE },
  });
  readonly album_name_text = new BitmapText({
    text: "",
    style: { fontFamily: SPINE_LABEL_ALBUM_NAME_FONT_NAME, fontSize: SPINE_LABEL_FONT_SIZE },
  });
  readonly cover_face = new Sprite(Texture.WHITE);
  spine_colour = 0x808080;

  constructor(spine_shading_texture: Texture) {
    this.spine_shading = new Sprite(spine_shading_texture);
    // Rotated a quarter turn clockwise, so the label reads from top to bottom as on UK CD spines.
    this.spine_label.rotation = Math.PI / 2;
    this.spine_label.addChild(this.artist_text, this.album_name_text);
    this.container.addChild(this.spine_face, this.spine_shading, this.spine_label, this.cover_face);
  }

  show_album(saved_album: SavedAlbum, spine_label_texts: SpineLabelTexts): void {
    this.spine_colour = saved_album.cover_dominant_colour ? parse_hex_colour(saved_album.cover_dominant_colour) : 0x808080;
    this.spine_face.tint = this.spine_colour;
    const label_colour = choose_spine_label_colour(this.spine_colour);
    this.artist_text.text = spine_label_texts.artist_text;
    this.album_name_text.text = spine_label_texts.album_name_text;
    this.artist_text.tint = label_colour;
    this.album_name_text.tint = label_colour;
    this.album_name_text.alpha = 0.85;
    this.album_name_text.x = this.artist_text.width + SPINE_LABEL_GAP_BETWEEN_ARTIST_AND_ALBUM_NAME;
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
  private readonly cover_texture_cache = new ShelfCoverTextureCache();
  private readonly displays_by_album_index = new Map<number, ShelfAlbumDisplay>();
  private readonly unused_displays: ShelfAlbumDisplay[] = [];
  private readonly open_amounts_by_album_index = new Map<number, number>();
  private spine_shading_texture: Texture = Texture.WHITE;
  private spine_label_texts_by_album_index: (SpineLabelTexts | undefined)[] = [];
  private saved_albums: readonly SavedAlbum[] = [];
  private shelf_geometry: ShelfGeometry = { spine_width: 24, cover_size: 200, edge_padding: SHELF_EDGE_PADDING };
  private scroll_x = 0;
  private scroll_target_x = 0;
  private pointer_x: number | null = null;
  private focused_album_index = -1;
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
    install_spine_label_fonts();
    this.spine_shading_texture = create_spine_shading_texture();
    this.application.stage.addChild(this.shelf_ledge, this.shelf_content);

    this.application.renderer.on("resize", () => this.update_geometry());
    this.update_geometry();
    this.listen_to_pointer_and_wheel();
    this.application.ticker.add((ticker) => this.render_frame(ticker.deltaMS));
  }

  set_albums(saved_albums: readonly SavedAlbum[]): void {
    this.saved_albums = saved_albums;
    this.spine_label_texts_by_album_index = [];
    this.open_amounts_by_album_index.clear();
    for (const [album_index, display] of this.displays_by_album_index) {
      this.release_display(album_index, display);
    }
    this.scroll_x = 0;
    this.scroll_target_x = 0;
    this.clamp_scroll_target();
    this.scroll_x = this.scroll_target_x;
  }

  /** Scrolls so that `scroll_target_x` is the left edge of the viewport, with easing. */
  scroll_to(scroll_target_x: number): void {
    this.scroll_target_x = scroll_target_x;
    this.clamp_scroll_target();
  }

  get maximum_scroll_x(): number {
    return Math.max(0, compute_shelf_content_width(this.saved_albums.length, this.shelf_geometry) - this.application.screen.width);
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
    const view_height = this.application.screen.height;
    const cover_size = Math.max(40, Math.floor(view_height - SHELF_TOP_PADDING - SHELF_LEDGE_HEIGHT));
    this.shelf_geometry = {
      spine_width: Math.round(cover_size * SPINE_WIDTH_TO_COVER_SIZE_RATIO),
      cover_size,
      edge_padding: SHELF_EDGE_PADDING,
    };
    this.spine_label_texts_by_album_index = [];
    for (const [album_index, display] of this.displays_by_album_index) {
      this.release_display(album_index, display);
    }
    this.shelf_ledge
      .clear()
      .rect(0, SHELF_TOP_PADDING + cover_size, this.application.screen.width, 2)
      .fill({ color: 0xffffff, alpha: 0.18 })
      .rect(0, SHELF_TOP_PADDING + cover_size + 2, this.application.screen.width, SHELF_LEDGE_HEIGHT - 2)
      .fill({ color: 0x000000, alpha: 0.25 });
    this.clamp_scroll_target();
  }

  private listen_to_pointer_and_wheel(): void {
    const canvas = this.application.canvas;
    canvas.addEventListener("pointermove", (pointer_event) => {
      this.pointer_x = pointer_event.offsetX;
    });
    canvas.addEventListener("pointerleave", () => {
      this.pointer_x = null;
    });
    canvas.addEventListener("click", () => {
      const focused_album = this.saved_albums[this.focused_album_index];
      if (focused_album) {
        this.options.on_album_click(focused_album);
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
        this.scroll_target_x += wheel_delta * line_scale;
        this.clamp_scroll_target();
      },
      { passive: false },
    );
  }

  private clamp_scroll_target(): void {
    const content_width = compute_shelf_content_width(this.saved_albums.length, this.shelf_geometry);
    const view_width = this.application.screen?.width ?? 0;
    if (content_width <= view_width) {
      // A library narrower than the window sits in the middle.
      this.scroll_target_x = (content_width - view_width) / 2;
      return;
    }
    this.scroll_target_x = Math.min(Math.max(this.scroll_target_x, 0), content_width - view_width);
  }

  private render_frame(frame_duration_ms: number): void {
    this.options.on_frame?.(frame_duration_ms);
    const album_count = this.saved_albums.length;
    if (album_count === 0) {
      return;
    }
    const view_width = this.application.screen.width;
    this.scroll_x = ease_toward(this.scroll_x, this.scroll_target_x, frame_duration_ms, SCROLL_EASING_TIME_CONSTANT_MS);
    if (Math.abs(this.scroll_x - this.scroll_target_x) < 0.1) {
      this.scroll_x = this.scroll_target_x;
    }

    const focus_x = this.pointer_x ?? view_width / 2;
    this.focused_album_index = find_closed_album_index_at(this.scroll_x + focus_x, album_count, this.shelf_geometry);
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
    display.spine_face.width = drawn_spine_width;
    display.spine_face.height = cover_size;
    display.spine_shading.width = drawn_spine_width;
    display.spine_shading.height = cover_size;

    display.spine_label.visible = open_amount < 0.6;
    display.spine_label.scale.y = 1 - open_amount;
    display.spine_label.x = drawn_spine_width / 2 + (display.artist_text.height / 2) * (1 - open_amount);
    display.spine_label.y = SPINE_LABEL_PADDING_ALONG_SPINE;

    display.cover_face.visible = open_amount > CLOSED_OPEN_AMOUNT_THRESHOLD;
    if (display.cover_face.visible) {
      const saved_album = this.saved_albums[album_index];
      const cover_url = this.options.cover_url_for_album(saved_album);
      const cover_texture = cover_url ? this.cover_texture_cache.get_or_start_loading(cover_url) : null;
      display.cover_face.texture = cover_texture ?? Texture.WHITE;
      display.cover_face.x = drawn_spine_width;
      display.cover_face.width = drawn_cover_width;
      display.cover_face.height = cover_size;
      const brightness = TURNING_COVER_MINIMUM_BRIGHTNESS + (1 - TURNING_COVER_MINIMUM_BRIGHTNESS) * open_amount;
      display.cover_face.tint = cover_texture ? scale_colour_brightness(0xffffff, brightness) : display.spine_colour;
    }
  }

  private acquire_display(album_index: number): ShelfAlbumDisplay {
    const display = this.unused_displays.pop() ?? new ShelfAlbumDisplay(this.spine_shading_texture);
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

  private spine_label_texts(album_index: number): SpineLabelTexts {
    let spine_label_texts = this.spine_label_texts_by_album_index[album_index];
    if (!spine_label_texts) {
      const measure_with_font = (font_weight: string) => (text: string) => {
        this.label_measuring_context.font = `${font_weight} ${SPINE_LABEL_FONT_SIZE}px ${SPINE_LABEL_FONT_FAMILY}`;
        return this.label_measuring_context.measureText(text).width;
      };
      spine_label_texts = fit_spine_label_texts(
        this.saved_albums[album_index],
        this.shelf_geometry.cover_size - 2 * SPINE_LABEL_PADDING_ALONG_SPINE,
        SPINE_LABEL_GAP_BETWEEN_ARTIST_AND_ALBUM_NAME,
        measure_with_font("700"),
        measure_with_font("400"),
      );
      this.spine_label_texts_by_album_index[album_index] = spine_label_texts;
    }
    return spine_label_texts;
  }
}

function install_spine_label_fonts(): void {
  for (const [font_name, font_weight] of [
    [SPINE_LABEL_ARTIST_FONT_NAME, "700"],
    [SPINE_LABEL_ALBUM_NAME_FONT_NAME, "400"],
  ] as const) {
    // White glyphs, tinted per spine. Missing characters, such as Japanese titles, are added on first use.
    BitmapFont.install({
      name: font_name,
      style: { fontFamily: SPINE_LABEL_FONT_FAMILY, fontSize: SPINE_LABEL_FONT_SIZE, fontWeight: font_weight, fill: 0xffffff },
      resolution: window.devicePixelRatio,
      dynamicFill: true,
    });
  }
}

/** A light left edge, a dark right edge and a soft curve between: the plastic edge of a jewel case. */
function create_spine_shading_texture(): Texture {
  const shading_canvas = document.createElement("canvas");
  shading_canvas.width = 32;
  shading_canvas.height = 1;
  const shading_context = shading_canvas.getContext("2d")!;
  const shading_gradient = shading_context.createLinearGradient(0, 0, 32, 0);
  shading_gradient.addColorStop(0, "rgba(255,255,255,0.35)");
  shading_gradient.addColorStop(0.06, "rgba(255,255,255,0.12)");
  shading_gradient.addColorStop(0.5, "rgba(255,255,255,0)");
  shading_gradient.addColorStop(0.9, "rgba(0,0,0,0.18)");
  shading_gradient.addColorStop(1, "rgba(0,0,0,0.5)");
  shading_context.fillStyle = shading_gradient;
  shading_context.fillRect(0, 0, 32, 1);
  return Texture.from(shading_canvas);
}

function scale_colour_brightness(rgb_colour: number, brightness: number): number {
  const scale_channel = (shift: number) => Math.round(((rgb_colour >> shift) & 0xff) * brightness) << shift;
  return scale_channel(16) | scale_channel(8) | scale_channel(0);
}
