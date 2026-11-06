/** Scroll events further apart than this always start a new swipe. */
const VERTICAL_SCROLL_GESTURE_GAP_MS = 300;
/** A vertical scroll smaller than this, such as a resting finger on a trackpad, does nothing. */
const VERTICAL_SCROLL_MINIMUM_DELTA = 3;
/** The scroll has died down once it falls to this share of the swipe's peak. */
const MOMENTUM_FALLEN_SHARE_OF_PEAK = 0.5;
/** After the scroll has died down, a rise to this many times its lowest value starts a new swipe. */
const NEW_SWIPE_RISE_RATIO = 2;
/** The rise must also be at least this large, so that small wobbles in the momentum do not count. */
const NEW_SWIPE_MINIMUM_RISE = 4;

/**
 * Lets one swipe or wheel turn act once. macOS sends momentum after the finger lifts: more events whose
 * deltaY shrinks over a second or more, with no flag that marks them as momentum. A new swipe is therefore
 * spotted by what momentum never does: a pause, a change of direction, or a rise after the scroll died down.
 */
export class VerticalScrollGestureGate {
  private last_vertical_scroll_ms = Number.NEGATIVE_INFINITY;
  private last_direction = 0;
  private gesture_acted = false;
  /** The largest |deltaY| of the swipe that acted, while it still rose. */
  private acted_swipe_peak = 0;
  /** The smallest |deltaY| since the acted swipe's peak. */
  private acted_swipe_trough = 0;
  private acted_swipe_fallen = false;

  constructor(private readonly now_ms: () => number = () => performance.now()) {}

  /** Notes a vertical scroll event, and returns true if it may act. */
  may_act(delta_y: number): boolean {
    const now_ms = this.now_ms();
    const size = Math.abs(delta_y);
    const direction = Math.sign(delta_y);
    if (this.starts_new_swipe(now_ms, size, direction)) {
      this.gesture_acted = false;
    } else if (this.gesture_acted) {
      this.follow_acted_swipe(size);
    }
    this.last_vertical_scroll_ms = now_ms;
    this.last_direction = direction;
    return !this.gesture_acted && size >= VERTICAL_SCROLL_MINIMUM_DELTA;
  }

  /** Marks the current swipe as used, so that its later events, momentum included, do not act. */
  mark_acted(): void {
    this.gesture_acted = true;
    this.acted_swipe_peak = 0;
    this.acted_swipe_trough = Number.POSITIVE_INFINITY;
    this.acted_swipe_fallen = false;
  }

  private starts_new_swipe(now_ms: number, size: number, direction: number): boolean {
    if (now_ms - this.last_vertical_scroll_ms >= VERTICAL_SCROLL_GESTURE_GAP_MS) {
      return true;
    }
    if (direction !== 0 && this.last_direction !== 0 && direction !== this.last_direction) {
      return true;
    }
    return (
      this.gesture_acted &&
      this.acted_swipe_fallen &&
      size >= this.acted_swipe_trough * NEW_SWIPE_RISE_RATIO &&
      size - this.acted_swipe_trough >= NEW_SWIPE_MINIMUM_RISE
    );
  }

  /** Tracks the acted swipe as it rises to its peak and dies down. */
  private follow_acted_swipe(size: number): void {
    if (!this.acted_swipe_fallen && size > this.acted_swipe_peak) {
      this.acted_swipe_peak = size;
      this.acted_swipe_trough = size;
      return;
    }
    this.acted_swipe_trough = Math.min(this.acted_swipe_trough, size);
    if (this.acted_swipe_trough <= this.acted_swipe_peak * MOMENTUM_FALLEN_SHARE_OF_PEAK) {
      this.acted_swipe_fallen = true;
    }
  }
}
