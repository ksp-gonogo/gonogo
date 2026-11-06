import { render } from "@ksp-gonogo/test-utils";
import { createDelayRailStore, DelayRailContext } from "@ksp-gonogo/ui-kit";
import { describe, expect, it } from "vitest";
import { RadioInboundRail } from "./RadioInboundRail";
import type { RadioLight } from "./RadioSession";

const ARES = "vessel:ares";
const KSC = "ksc";

function light(over: Partial<RadioLight> = {}): RadioLight {
  return {
    transmissionId: "t1",
    threadKey: "g1",
    with: [ARES],
    from: ARES,
    authorName: "Jeb",
    muted: false,
    amplitudes: [0.2, 0.6],
    waves: [
      { lo: -0.2, hi: 0.2 },
      { lo: -0.6, hi: 0.6 },
    ],
    ...over,
  };
}

function mount(
  live: readonly RadioLight[],
  pairs = new Map([[ARES, new Map([[KSC, 1.3]])]]),
) {
  const store = createDelayRailStore();
  render(
    <DelayRailContext.Provider value={store}>
      <RadioInboundRail
        live={live}
        me={KSC}
        fallbackSeconds={null}
        pairs={pairs}
        nameFor={(id) => (id === ARES ? "MkI" : id)}
      />
    </DelayRailContext.Provider>,
  );
  return store;
}

describe("a voice arriving, on the rail", () => {
  it("registers one ribbon per voice, telemetry and continuous, so it lies in the confirmed zone", () => {
    const store = mount([light()]);
    const handle = store.getActiveHandles()[0];
    expect(handle?.tags).toEqual({
      direction: "telemetry",
      kind: "continuous",
      delivery: "fire-and-forget",
    });
    expect(handle?.ribbons).toHaveLength(1);
    expect(handle?.ribbons?.[0]?.amplitudes).toEqual([0.2, 0.6]);
    expect(handle?.ribbons?.[0]?.wave).toEqual([
      { lo: -0.2, hi: 0.2 },
      { lo: -0.6, hi: 0.6 },
    ]);
    expect(handle?.ribbons?.[0]?.label).toBe("Voice from MkI arriving");
  });

  it("places it on the delay from its speaker to this vantage", () => {
    const store = mount([light()]);
    const handle = store.getActiveHandles()[0];
    expect(handle?.effectiveDelaySeconds).toBe(1.3);
    expect(handle?.ribbons?.[0]?.oneWaySeconds).toBe(1.3);
  });

  it("registers nothing when nobody is talking, or the speaker has no path here", () => {
    expect(mount([]).getActiveHandles()).toHaveLength(0);
    expect(mount([light()], new Map()).getActiveHandles()).toHaveLength(0);
  });
});
