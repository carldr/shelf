import { describe, expect, it } from "vitest";
import { VerticalScrollGestureGate } from "./vertical_scroll_gesture_gate";

/** Feeds deltas 16 ms apart, as macOS sends them, acting whenever the gate allows; returns the deltas that acted. */
function feed_scroll_deltas(gate: VerticalScrollGestureGate, advance: (elapsed_ms: number) => void, deltas: number[]) {
  const acted_deltas: number[] = [];
  for (const delta_y of deltas) {
    advance(16);
    if (gate.may_act(delta_y)) {
      gate.mark_acted();
      acted_deltas.push(delta_y);
    }
  }
  return acted_deltas;
}

function create_gate() {
  let now_ms = 1_000;
  const gate = new VerticalScrollGestureGate(() => now_ms);
  return { gate, advance: (elapsed_ms: number) => (now_ms += elapsed_ms) };
}

/** A finger swipe down that rises to its peak, then the momentum tail that macOS sends after the finger lifts. */
const SWIPE_DOWN_WITH_MOMENTUM = [4, 8, 15, 22, 18, 14, 11, 9, 7, 5, 4, 3, 2, 2, 1, 1, 1, 1];

describe("VerticalScrollGestureGate", () => {
  it("lets a swipe and its momentum act once", () => {
    const { gate, advance } = create_gate();
    expect(feed_scroll_deltas(gate, advance, SWIPE_DOWN_WITH_MOMENTUM)).toEqual([4]);
  });

  it("lets a new swipe act during the previous swipe's momentum", () => {
    const { gate, advance } = create_gate();
    feed_scroll_deltas(gate, advance, [4, 8, 15, 22, 18, 14, 11, 9, 7, 5, 4, 3]);
    expect(feed_scroll_deltas(gate, advance, [6, 12, 20, 25])).toEqual([12]);
  });

  it("lets a swipe in the other direction act at once", () => {
    const { gate, advance } = create_gate();
    feed_scroll_deltas(gate, advance, [4, 8, 15, 22, 18, 14]);
    expect(feed_scroll_deltas(gate, advance, [-5, -10, -18])).toEqual([-5]);
  });

  it("ignores small wobbles in the momentum", () => {
    const { gate, advance } = create_gate();
    expect(feed_scroll_deltas(gate, advance, [4, 8, 15, 22, 18, 14, 11, 9, 10, 8, 7, 8, 6, 5])).toEqual([4]);
  });

  it("starts a new swipe after a pause", () => {
    const { gate, advance } = create_gate();
    feed_scroll_deltas(gate, advance, SWIPE_DOWN_WITH_MOMENTUM);
    advance(400);
    expect(feed_scroll_deltas(gate, advance, [4, 8])).toEqual([4]);
  });

  it("keeps a swipe usable while nothing has acted on it", () => {
    const { gate, advance } = create_gate();
    advance(16);
    expect(gate.may_act(20)).toBe(true);
    advance(16);
    expect(gate.may_act(20)).toBe(true);
  });

  it("ignores very small scrolls", () => {
    const { gate } = create_gate();
    expect(gate.may_act(1)).toBe(false);
  });
});
