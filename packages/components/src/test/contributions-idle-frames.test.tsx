import {
  CORE_UPLINK_CLIENT,
  ContributionsProvider,
  WidgetMetaContext,
} from "@ksp-gonogo/core";
import { act, render } from "@ksp-gonogo/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "./setupStreamFixture";

/**
 * A slot's contributions are recomputed when their inputs move, not on every
 * frame. Each widget on a dashboard carries its slots, and a frame arrives on
 * every animation tick whether or not anything changed, so a recompute per
 * frame is a render per widget per tick for a board that is sitting still.
 */

let emptyComputes = 0;
let linkComputes = 0;

CORE_UPLINK_CLIENT.registerContribution({
  id: "idle-probe-empty",
  contributes: "idle-probe-empty.badges",
  deps: [],
  compute: () => {
    emptyComputes++;
    return [];
  },
});

CORE_UPLINK_CLIENT.registerContribution({
  id: "idle-probe-link",
  contributes: "idle-probe-link.badges",
  deps: ["comms.link"],
  compute: () => {
    linkComputes++;
    return [];
  },
});

function mount(componentId: string) {
  const fixture = setupStreamFixture({
    carriedChannels: ["comms.link"],
    pinnedUt: 10,
    suspendFrames: true,
  });
  const view = render(
    <fixture.Provider>
      <WidgetMetaContext.Provider
        value={{ componentId, contributionSlots: [] }}
      >
        <ContributionsProvider>{null}</ContributionsProvider>
      </WidgetMetaContext.Provider>
    </fixture.Provider>,
  );
  return { fixture, unmount: view.unmount };
}

function idleFrames(fixture: ReturnType<typeof mount>["fixture"], n: number) {
  for (let i = 0; i < n; i++) {
    act(() => {
      fixture.store.beginFrame();
    });
  }
}

let unmount: (() => void) | undefined;
afterEach(() => {
  unmount?.();
  unmount = undefined;
});

describe("contribution slots across frames that change nothing", () => {
  it("never recomputes a slot with no inputs", () => {
    const mounted = mount("idle-probe-empty");
    unmount = mounted.unmount;
    const settled = emptyComputes;

    idleFrames(mounted.fixture, 5);

    expect(settled).toBeGreaterThan(0);
    expect(emptyComputes).toBe(settled);
  });

  it("recomputes only when an input's reading moves", () => {
    const mounted = mount("idle-probe-link");
    unmount = mounted.unmount;
    act(() => {
      mounted.fixture.emit("comms.link", { connected: true });
      mounted.fixture.store.beginFrame();
    });
    const settled = linkComputes;

    idleFrames(mounted.fixture, 5);
    expect(linkComputes).toBe(settled);

    act(() => {
      mounted.fixture.emit("comms.link", { connected: false });
      mounted.fixture.store.beginFrame();
    });
    expect(linkComputes).toBe(settled + 1);
  });
});
