import { describe, expect, it } from "vitest";
import { VerticalScrollGestureGate } from "./vertical_scroll_gesture_gate";

describe("VerticalScrollGestureGate", () => {
  function create_gate() {
    let now_ms = 0;
    const gate = new VerticalScrollGestureGate(() => now_ms);
    return { gate, advance: (elapsed_ms: number) => (now_ms += elapsed_ms) };
  }

  it("lets a swipe act once, and a new swipe after a pause act again", () => {
    const { gate, advance } = create_gate();
    expect(gate.may_act(20)).toBe(true);
    gate.mark_acted();
    advance(16);
    expect(gate.may_act(20)).toBe(false);
    advance(400);
    expect(gate.may_act(20)).toBe(true);
  });

  it("keeps a swipe usable while nothing has acted on it", () => {
    const { gate, advance } = create_gate();
    expect(gate.may_act(20)).toBe(true);
    advance(16);
    expect(gate.may_act(20)).toBe(true);
  });

  it("ignores very small scrolls", () => {
    const { gate } = create_gate();
    expect(gate.may_act(1)).toBe(false);
  });

  it("treats momentum within 300 ms of the last event as the same swipe", () => {
    const { gate, advance } = create_gate();
    gate.may_act(20);
    gate.mark_acted();
    for (let event_index = 0; event_index < 60; event_index += 1) {
      advance(16);
      expect(gate.may_act(20)).toBe(false);
    }
  });
});
