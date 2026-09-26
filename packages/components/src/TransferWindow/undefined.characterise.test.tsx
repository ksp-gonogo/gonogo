import { clearRegistry, DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { TransferWindowComponent } from "./index";

/**
 * Characterisation of TransferWindow's `undefined` telemetry reads. Three
 * absence gates decide what it draws: no orbit or origin, missing orbital
 * elements, and an unset target, which silently picks the first destination.
 */

const DEG = Math.PI / 180;

// Same wire bodies as index.test.tsx, so the two files agree on the system.
const SUN = {
  index: 0,
  name: "Sun",
  gravParameter: 1.32712440018e20,
  radius: 6.957e8,
};
const EARTH = {
  index: 1,
  name: "Earth",
  parentIndex: 0,
  gravParameter: 3.986004418e14,
  radius: 6.371e6,
  orbit: {
    sma: 1.495978707e11,
    ecc: 0,
    inc: 0,
    lan: 0,
    argPe: 0,
    meanAnomalyAtEpoch: 0,
    epoch: 0,
  },
};
const MARS = {
  index: 2,
  name: "Mars",
  parentIndex: 0,
  gravParameter: 4.282837e13,
  radius: 3.3895e6,
  orbit: {
    sma: 2.279392e11,
    ecc: 0,
    inc: 0,
    lan: 0,
    argPe: 0,
    meanAnomalyAtEpoch: 44.3 * DEG,
    epoch: 0,
  },
};
const VENUS = {
  index: 3,
  name: "Venus",
  parentIndex: 0,
  gravParameter: 3.24859e14,
  radius: 6.0518e6,
  orbit: {
    sma: 1.08208e11,
    ecc: 0,
    inc: 0,
    lan: 0,
    argPe: 0,
    meanAnomalyAtEpoch: 0,
    epoch: 0,
  },
};

const LEO = {
  referenceBodyIndex: 1,
  sma: 7.071e6,
  ecc: 0,
  inc: 0,
  lan: 0,
  argPe: 0,
  meanAnomalyAtEpoch: 0,
  epoch: 0,
  mu: 3.986004418e14,
};

// Unmounted before clearRegistry, whose notification on a mounted widget lands outside act().
const renderedTrees: Array<() => void> = [];

function renderTracked(ui: ReactElement) {
  const result = render(ui);
  renderedTrees.push(result.unmount);
  return result;
}

afterEach(() => {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
  clearRegistry();
});

function setup() {
  const fixture = setupStreamFixture({
    carriedChannels: ["system.bodies", "vessel.orbit", "target.available"],
    pinnedUt: 0,
    suspendFrames: true,
  });
  const view = renderTracked(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "transfer-char" }}>
        <TransferWindowComponent
          id="transfer-char"
          config={{ showPorkchop: true }}
        />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  return { fixture, view };
}

/** Everything the widget needs to render its instruments, minus `overrides`. */
function emitReady(
  fixture: ReturnType<typeof setupStreamFixture>,
  orbitOverrides: Record<string, unknown> = {},
) {
  fixture.emit("system.bodies", { bodies: [SUN, EARTH, MARS, VENUS] });
  fixture.emit("vessel.orbit", { ...LEO, ...orbitOverrides });
}

/** The raw `vessel.orbit` point for this frame, so an "unchanged by an emit" test proves the emit landed. */
async function landedOrbitPoint(
  fixture: ReturnType<typeof setupStreamFixture>,
): Promise<{ payload: unknown }> {
  let point: { payload: unknown } | undefined;
  await waitFor(() => {
    point = fixture.store.sample("vessel.orbit", fixture.store.currentFrame());
    if (!point) throw new Error("vessel.orbit point has not landed");
  });
  if (!point) throw new Error("vessel.orbit point has not landed");
  return point;
}

describe("TransferWindow: nothing has arrived at all", () => {
  it("renders the waiting-for-orbit placeholder and none of the three instruments", async () => {
    const { view } = setup();
    // Nothing has come yet, and the copy says so.
    expect(
      await screen.findByText("Waiting for vessel orbit..."),
    ).toBeInTheDocument();

    // Named absences: the dial, the list and the chart are each specifically gone.
    expect(screen.queryByText("Current phase")).not.toBeInTheDocument();
    expect(screen.queryByText(/^Windows to /)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("img", { name: /Δv contour/i }),
    ).not.toBeInTheDocument();
    // The destination picker in the header goes too, so there is no control at all.
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(visibleText(view.container)).toContain("Transfer Window");
  });

  it("renders the same placeholder with no TelemetryProvider mounted at all", async () => {
    // No provider in the tree is indistinguishable from a cold topic.
    const view = renderTracked(
      <DashboardItemContext.Provider value={{ instanceId: "transfer-nop" }}>
        <TransferWindowComponent
          id="transfer-nop"
          config={{ showPorkchop: true }}
        />
      </DashboardItemContext.Provider>,
    );
    expect(
      await screen.findByText("Waiting for vessel orbit..."),
    ).toBeInTheDocument();
    expect(visibleText(view.container)).toContain("Transfer Window");
  });
});

describe("TransferWindow: the absence gates fire today", () => {
  it("blames the vessel orbit when the orbit HAS arrived and system.bodies has not", async () => {
    // `!orbit || !origin` is one message for two absences: here only the body table is missing.
    const { fixture } = setup();
    await screen.findByText("Waiting for vessel orbit...");
    act(() => {
      fixture.emit("vessel.orbit", LEO);
    });
    expect(await landedOrbitPoint(fixture)).toBeTruthy();
    expect(screen.getByText("Waiting for vessel orbit...")).toBeInTheDocument();
    expect(screen.queryByText("Current phase")).not.toBeInTheDocument();
  });

  /** `absent` is the subject confirming there is no orbit, which gets its own wording rather than a wait. */
  it("names the confirmed vessel.orbit tombstone as no orbit rather than a wait", async () => {
    const { fixture } = setup();
    await screen.findByText("Waiting for vessel orbit...");
    act(() => {
      fixture.emit("system.bodies", { bodies: [SUN, EARTH, MARS, VENUS] });
      fixture.emit("vessel.orbit", null);
    });
    // The tombstone genuinely reached the store.
    expect((await landedOrbitPoint(fixture)).payload).toBeNull();
    expect(screen.getByText(/No parking orbit/)).toBeInTheDocument();
    expect(
      screen.queryByText("Waiting for vessel orbit..."),
    ).not.toBeInTheDocument();
  });

  it("treats a null referenceBodyIndex the same as an absent one", async () => {
    // A present record with a nulled index also reads as "waiting".
    const { fixture } = setup();
    await screen.findByText("Waiting for vessel orbit...");
    act(() => {
      emitReady(fixture, { referenceBodyIndex: null });
    });
    const point = await landedOrbitPoint(fixture);
    expect(Reflect.get(point.payload ?? {}, "referenceBodyIndex")).toBeNull();
    expect(screen.getByText("Waiting for vessel orbit...")).toBeInTheDocument();
  });

  it("clears the placeholder once both reads land, proving the gate is what produced it", async () => {
    // Contrast case: proves the gate fires rather than the fixture feeding nothing.
    const { fixture } = setup();
    await screen.findByText("Waiting for vessel orbit...");
    act(() => {
      emitReady(fixture);
    });
    await waitFor(() =>
      expect(screen.getByText("Current phase")).toBeInTheDocument(),
    );
    expect(
      screen.queryByText("Waiting for vessel orbit..."),
    ).not.toBeInTheDocument();
  });
});

describe("TransferWindow: a partial vessel.orbit payload", () => {
  it("shows the second placeholder, and keeps the destination picker, when sma and ecc are missing", async () => {
    // Only `parkingRadius` is unresolvable: different copy, and the destination control stays live.
    const { fixture } = setup();
    await screen.findByText("Waiting for vessel orbit...");
    act(() => {
      emitReady(fixture, { sma: undefined, ecc: undefined });
    });
    expect(
      await screen.findByText("Waiting for orbital elements..."),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Waiting for vessel orbit..."),
    ).not.toBeInTheDocument();
    expect(await screen.findByLabelText(/Windows to/)).toBeInTheDocument();
    expect(screen.queryByText("Current phase")).not.toBeInTheDocument();
  });

  it("shows the same second placeholder when only ecc is missing", async () => {
    // A conjunction, so one absent field reads exactly as both absent.
    const { fixture } = setup();
    await screen.findByText("Waiting for vessel orbit...");
    act(() => {
      emitReady(fixture, { ecc: undefined });
    });
    expect(
      await screen.findByText("Waiting for orbital elements..."),
    ).toBeInTheDocument();
  });
});

describe("TransferWindow: an absent target.available picks a destination anyway", () => {
  it("defaults to the first sibling body with no indication that nothing was targeted", async () => {
    // An absent `target.available` silently plans a transfer to the first sibling, with nothing on screen saying so.
    const { fixture } = setup();
    act(() => {
      emitReady(fixture);
    });
    const select = await screen.findByLabelText(/Windows to/);
    expect((select as HTMLSelectElement).value).toBe("2"); // Mars, dests[0]
    expect(await screen.findByText(/^Windows to$/)).toBeInTheDocument();
  });

  it("reads a target.available tombstone the same way", async () => {
    // A confirmed empty target list and a never-arrived one both fall through to the first sibling.
    const { fixture } = setup();
    act(() => {
      emitReady(fixture);
      fixture.emit("target.available", null);
    });
    const select = await screen.findByLabelText(/Windows to/);
    expect((select as HTMLSelectElement).value).toBe("2");
  });

  it("honours the targeted body when target.available IS present, proving the fallback is a fallback", async () => {
    const { fixture } = setup();
    act(() => {
      emitReady(fixture);
      fixture.emit("target.available", {
        entries: [{ kind: 1, name: "Venus", bodyIndex: 3, isCurrent: true }],
      });
    });
    const select = await screen.findByLabelText(/Windows to/);
    await waitFor(() => expect((select as HTMLSelectElement).value).toBe("3"));
  });
});
