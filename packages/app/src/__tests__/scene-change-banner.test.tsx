import {
  createFakeWallClock,
  StubTransport,
  TelemetryClient,
  TelemetryProvider,
  TimelineStore,
  ViewClock,
} from "@ksp-gonogo/sitrep-client";
import { act, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SceneChangeBanner } from "../components/SceneChangeBanner";

// SceneChangeBanner reads `spaceCenter.scene` off the mod-side stream (the
// canonical `useTelemetry("spaceCenter.scene")?.scene`). Drive it with a real
// `TelemetryProvider` (`TelemetryClient` + `TimelineStore` over a
// `StubTransport`) — mirrors `flight-outcome-banner.test.tsx`'s
// `setupTelemetryStream`, itself mirroring
// `packages/components/src/test/setupStreamFixture.tsx`. `spaceCenter.scene`
// is a raw wire topic (no derived channel to register), so a per-scene emit +
// a manual `store.beginFrame()` is all that's needed to advance the pinned
// frame — `beginFrame()` is synchronous, so it works under the fake timers the
// auto-hide assertion needs.
function setupSceneStream() {
  const wall = createFakeWallClock();
  const transport = new StubTransport();
  const client = new TelemetryClient(transport);
  const clock = new ViewClock({
    nowWall: wall.now,
    warpRate: () => 1,
    delaySeconds: () => 0,
  });
  const store = new TimelineStore(clock);
  // Pin the view clock so `store.sample(topic, currentFrame())` resolves — the
  // scene events emit at the default `validAt: 0`, so any pinned UT >= 0 sees
  // the latest one.
  clock.scrubTo(10);

  function Provider({ children }: { children: ReactNode }) {
    return (
      <TelemetryProvider
        client={client}
        store={store}
        carriedChannels={["spaceCenter.scene"]}
      >
        {children}
      </TelemetryProvider>
    );
  }

  return {
    Provider,
    emitScene: (scene: string) => {
      act(() => {
        transport.emit("spaceCenter.scene", { scene });
        store.beginFrame();
      });
    },
  };
}

describe("SceneChangeBanner", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("stays hidden on the first scene sample (initial state, not a transition)", () => {
    const fixture = setupSceneStream();

    const { container } = render(
      <fixture.Provider>
        <SceneChangeBanner />
      </fixture.Provider>,
    );

    fixture.emitScene("SpaceCenter");
    expect(container.textContent).toBe("");
  });

  it("surfaces a from→to banner when the scene changes", () => {
    const fixture = setupSceneStream();

    render(
      <fixture.Provider>
        <SceneChangeBanner />
      </fixture.Provider>,
    );

    fixture.emitScene("SpaceCenter");
    fixture.emitScene("Flight");

    expect(screen.getByText("Space Center")).toBeInTheDocument();
    expect(screen.getByText("Flight")).toBeInTheDocument();
  });

  it("auto-hides after the visible window expires", () => {
    const fixture = setupSceneStream();

    const { container } = render(
      <fixture.Provider>
        <SceneChangeBanner />
      </fixture.Provider>,
    );

    fixture.emitScene("SpaceCenter");
    fixture.emitScene("Flight");
    expect(container.textContent).not.toBe("");

    act(() => {
      vi.advanceTimersByTime(11_000);
    });
    expect(container.textContent).toBe("");
  });
});
