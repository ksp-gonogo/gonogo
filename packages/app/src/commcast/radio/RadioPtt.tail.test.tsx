import { act, render } from "@ksp-gonogo/sitrep-sdk/testing";
import { createDelayRailStore, DelayRailContext } from "@ksp-gonogo/ui-kit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RadioPtt } from "./RadioPtt";
import type { RadioControl } from "./useRadio";

const SEPARATION = 8;

function keyed(over: Partial<RadioControl> = {}): RadioControl {
  const amplitudes = Array.from({ length: 50 }, () => 0.6);
  return {
    transmitting: true,
    opening: false,
    amplitudes,
    waves: amplitudes.map(() => ({ lo: -0.5, hi: 0.5 })),
    reception: { live: [], backlogSeconds: 0, droppedChunks: 0 },
    unavailable: null,
    fault: null,
    toggle: () => {},
    isMuted: () => false,
    setMuted: () => {},
    inputDeviceId: null,
    setInputDevice: () => {},
    ...over,
  };
}

function mount(radio: RadioControl) {
  const store = createDelayRailStore();
  const tree = (r: RadioControl) => (
    <DelayRailContext.Provider value={store}>
      <RadioPtt radio={r} separationSeconds={SEPARATION} />
    </DelayRailContext.Provider>
  );
  const view = render(tree(radio));
  return {
    ribbon: () =>
      store.getActiveHandles().flatMap((h) => h.ribbons ?? [])[0] ?? null,
    release: () => view.rerender(tree(keyed({ transmitting: false }))),
  };
}

describe("a transmission already on the rail when Talk is released", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps travelling until it has crossed the whole rail, then goes", () => {
    const { ribbon, release } = mount(keyed());
    expect(ribbon()).not.toBeNull();

    release();
    expect(ribbon()).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime((SEPARATION - 1) * 1000);
    });
    expect(ribbon()).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(ribbon()).toBeNull();
  });
});
