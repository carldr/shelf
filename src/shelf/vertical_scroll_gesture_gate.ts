/** Scroll events less than this apart belong to one swipe or wheel turn. */
const VERTICAL_SCROLL_GESTURE_GAP_MS = 300;
/** A vertical scroll smaller than this, such as a resting finger on a trackpad, does nothing. */
const VERTICAL_SCROLL_MINIMUM_DELTA = 3;

/**
 * Lets one swipe or wheel turn act once. Trackpad momentum and a steady wheel send many events,
 * and each event extends the swipe, so a turned album does not turn again from the same swipe.
 * A swipe counts as used only once something acts on it.
 */
export class VerticalScrollGestureGate {
  private last_vertical_scroll_ms = Number.NEGATIVE_INFINITY;
  private gesture_acted = false;

  constructor(private readonly now_ms: () => number = () => performance.now()) {}

  /** Notes a vertical scroll event, and returns true if it may act. */
  may_act(delta_y: number): boolean {
    const now_ms = this.now_ms();
    if (now_ms - this.last_vertical_scroll_ms >= VERTICAL_SCROLL_GESTURE_GAP_MS) {
      this.gesture_acted = false;
    }
    this.last_vertical_scroll_ms = now_ms;
    return !this.gesture_acted && Math.abs(delta_y) >= VERTICAL_SCROLL_MINIMUM_DELTA;
  }

  /** Marks the current swipe as used, so that its later events do not act. */
  mark_acted(): void {
    this.gesture_acted = true;
  }
}
