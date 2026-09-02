import type { PartStateModule, VesselTopology } from "@ksp-gonogo/core";
import {
  act,
  render as rtlRender,
  screen,
  waitFor,
} from "@ksp-gonogo/test-utils";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import {
  type PartLiveWireInput,
  topologyToVesselPartsWire,
} from "../test/topologyToVesselPartsWire";
import fuellinePrelaunch from "./__fixtures__/fuelline-tester-22parts-prelaunch.json";
import fuellinePrelaunchPartState from "./__fixtures__/fuelline-tester-22parts-prelaunch.partState.json";
import { ShipMapComponent } from "./index";

/**
 * CHARACTERISATION: what `undefined` MEANS at each of ShipMap's read sites
 * today, recorded before `useTelemetry` returns a `Reading`.
 *
 * Four reads, four different meanings:
 *
 *   - `vessel.parts` absent -> `useTopology` gives undefined -> the "waiting"
 *     placeholder, and NO diagram. The one read whose absence the operator sees
 *   - `vessel.control.throttle` absent -> COERCED TO ZERO, so an engine reported
 *     active draws no flame: byte-identical to a confirmed idle throttle
 *   - `vessel.thermal.hottestPart.name` absent -> no "hot:" tag, silently
 *   - `vessel.flight.externalTemperature` absent -> no ambient tint, which is
 *     also what a confirmed comfortable 300 K renders
 *
 * `useTopology`'s own `wire ? ... : undefined` additionally folds a store-level
 * tombstone into the pending placeholder, so "there is no vessel" and "nothing
 * has arrived" are the same sentence on screen.
 */

const TOPOLOGY = fuellinePrelaunch["v.topology"] as VesselTopology;

/** The sidecar's three active engines, in the `vessel.parts` wire's own shape. */
const PART_LIVE = new Map<number, PartLiveWireInput>(
  Object.entries(fuellinePrelaunchPartState as Record<string, unknown>)
    .filter(([key]) => key !== "_comment")
    .map(([flightId, modules]) => [
      Number(flightId),
      { partState: { seq: 0, modules: modules as PartStateModule[] } },
    ]),
);

const VESSEL_PARTS_WIRE = topologyToVesselPartsWire(TOPOLOGY, PART_LIVE);

const CARRIED = [
  "vessel.parts",
  "vessel.control",
  "vessel.thermal",
  "vessel.flight",
];

const PLACEHOLDER_WAITING =
  /**
   * The domain-free half of the widget's own copy. Asserting the whole sentence
   * would duplicate the legacy data-source name into this file, which
   * `uplink-boundary` reads as a mod reference from `packages/`, and would make
   * the test rewrite itself every time the copy is reworded around it.
   */
  /Waiting for vessel topology/;

const renderedTrees: Array<() => void> = [];

function render(ui: ReactElement) {
  const result = rtlRender(ui);
  renderedTrees.push(result.unmount);
  return result;
}

afterEach(() => {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
});

function mount() {
  const fixture = setupStreamFixture({
    carriedChannels: CARRIED,
    pinnedUt: 0,
    suspendFrames: true,
  });
  const { container } = render(
    <fixture.Provider>
      <ShipMapComponent id="ship-map-characterise" w={8} h={10} />
    </fixture.Provider>,
  );
  return { fixture, container };
}

/** The ambient-tint layer, identified by the one style it alone carries. */
function tintLayer(container: HTMLElement): HTMLElement | undefined {
  return Array.from(container.querySelectorAll<HTMLElement>("div")).find((el) =>
    el.style.transition.includes("background 400ms"),
  );
}

function flameCount(container: HTMLElement): number {
  return container.querySelectorAll('g[data-role="engine-flame"]').length;
}

describe("ShipMap: nothing has arrived at all", () => {
  it("renders the waiting placeholder and NO diagram", () => {
    const { container } = mount();

    // `if (!topology)` fires. This is the widget's honest read of absence, and
    // the only one of its four that the operator can see.
    expect(screen.getByText(PLACEHOLDER_WAITING)).toBeTruthy();
    // Named-element absence, not an empty container: the diagram is the thing
    // that must not be there.
    expect(screen.queryByLabelText("Ship diagram")).toBeNull();
    expect(flameCount(container)).toBe(0);
    // The header meta row (part count + seq) belongs to the diagram branch, so
    // it is absent too.
    expect(screen.queryByText(/part/)).toBeNull();
    expect(screen.queryByText(/seq/)).toBeNull();
  });
});

describe("ShipMap: the `!topology` gate versus the empty-parts gate", () => {
  it("an ARRIVED but empty parts list says 'Vessel has no parts', not 'waiting'", async () => {
    const { fixture } = mount();

    act(() => {
      fixture.emit("vessel.parts", { parts: [] });
    });

    // The one place ShipMap distinguishes "nothing arrived" from "arrived and
    // there is nothing": a truthy record with zero parts takes the second
    // placeholder.
    await waitFor(() =>
      expect(screen.getByText("Vessel has no parts.")).toBeTruthy(),
    );
    expect(screen.queryByText(PLACEHOLDER_WAITING)).toBeNull();
  });

  it("a whole-topic tombstone falls back to the WAITING placeholder, not the empty one", async () => {
    const { fixture } = mount();

    // Land a real vessel first, so the tombstone below is provably delivered.
    act(() => {
      fixture.emit("vessel.parts", VESSEL_PARTS_WIRE);
    });
    await waitFor(() =>
      expect(screen.getByLabelText("Ship diagram")).toBeTruthy(),
    );

    act(() => {
      fixture.emit("vessel.parts", null);
    });

    // `useTopology`'s `wire ? derive(wire) : undefined` treats the store's
    // confirmed "there is no value" as "nothing has arrived", so a vessel that
    // demonstrably went away is reported as a data-source problem.
    await waitFor(() =>
      expect(screen.getByText(PLACEHOLDER_WAITING)).toBeTruthy(),
    );
    expect(screen.queryByLabelText("Ship diagram")).toBeNull();
  });
});

function controlWire(throttle?: number) {
  return {
    sas: false,
    sasMode: 0,
    rcs: false,
    gear: false,
    brakes: false,
    lights: false,
    actionGroups: [],
    ...(throttle === undefined ? {} : { throttle }),
  };
}

/** What the store actually holds for `topic`, independent of what the widget
 *  chose to draw from it. The delivery proof for a read whose value never
 *  reaches the DOM. */
function sampled(fixture: ReturnType<typeof mount>["fixture"], topic: string) {
  return fixture.store.sample(topic, fixture.store.currentFrame())?.payload as
    | Record<string, unknown>
    | undefined;
}

describe("ShipMap: the throttle coercion to zero", () => {
  it("draws no engine flame off an absent throttle, and none off a confirmed 0.5 either", async () => {
    const { fixture, container } = mount();

    act(() => {
      fixture.emit("vessel.parts", VESSEL_PARTS_WIRE);
    });
    await waitFor(() =>
      expect(screen.getByLabelText("Ship diagram")).toBeTruthy(),
    );

    // Three engines report `state: "active"`, and `vessel.control` has never
    // arrived: `throttle` is coerced to 0, so the flame gate closes and the
    // diagram shows a dead stack under thrust.
    expect(flameCount(container)).toBe(0);

    act(() => {
      fixture.emit("vessel.control", controlWire(0.5));
    });

    // The record lands, and the store holds a real half throttle for it.
    await waitFor(() =>
      expect(sampled(fixture, "vessel.control")).toBeTruthy(),
    );
    expect(sampled(fixture, "vessel.control")?.throttle).toMatchObject({
      magnitude: 0.5,
    });

    // And the diagram still draws no flame. `throttleRaw` is the unit-WRAPPED
    // `Value<"ratio">` the wire carries, so `typeof throttleRaw === "number"`
    // rejects it and the coercion to 0 fires for a present, non-zero throttle.
    // The absence branch is the ONLY branch this widget can reach today, which
    // makes "nothing arrived" indistinguishable from every throttle there is.
    expect(flameCount(container)).toBe(0);

    act(() => {
      fixture.emit("vessel.control", controlWire(0));
    });
    await waitFor(() =>
      expect(sampled(fixture, "vessel.control")?.throttle).toMatchObject({
        magnitude: 0,
      }),
    );
    expect(flameCount(container)).toBe(0);
  });

  it("a partial vessel.control (record present, throttle field absent) coerces to zero too", async () => {
    const { fixture, container } = mount();

    act(() => {
      fixture.emit("vessel.parts", VESSEL_PARTS_WIRE);
      fixture.emit("vessel.control", controlWire());
    });
    await waitFor(() =>
      expect(sampled(fixture, "vessel.control")).toBeTruthy(),
    );

    // A record with no `throttle` at all lands on the same render as a record
    // with one, and as no record: three states, one picture.
    expect(sampled(fixture, "vessel.control")?.throttle).toBeUndefined();
    expect(flameCount(container)).toBe(0);
  });
});

describe("ShipMap: the silent absence gates", () => {
  it("an absent hottestPart drops the 'hot:' tag with no trace", async () => {
    const { fixture } = mount();

    act(() => {
      fixture.emit("vessel.parts", VESSEL_PARTS_WIRE);
    });
    await waitFor(() =>
      expect(screen.getByLabelText("Ship diagram")).toBeTruthy(),
    );

    // `typeof hottestPartName === "string" ? ... : null` -> `highlight` null ->
    // `{highlight && ...}`. Absence renders nothing at all, so the operator sees
    // a diagram with no hottest part rather than a diagram with an unknown one.
    expect(screen.queryByText(/hot:/)).toBeNull();

    act(() => {
      fixture.emit("vessel.thermal", {
        hottestPart: { name: "liquidEngine2.v2", temperature: 900 },
      });
    });

    await waitFor(() =>
      expect(screen.getByText(/hot: liquidEngine2\.v2/)).toBeTruthy(),
    );

    act(() => {
      // The record arrives without the nested part: the tag goes away again,
      // indistinguishable from the thermal channel never having spoken.
      fixture.emit("vessel.thermal", {});
    });

    await waitFor(() => expect(screen.queryByText(/hot:/)).toBeNull());
  });

  it("an absent externalTemperature paints a transparent tint, and so does a confirmed 1000 K", async () => {
    const { fixture, container } = mount();

    act(() => {
      fixture.emit("vessel.parts", VESSEL_PARTS_WIRE);
    });
    await waitFor(() =>
      expect(screen.getByLabelText("Ship diagram")).toBeTruthy(),
    );

    // `externalTempTint(undefined)` -> null -> `ambientTint ?? "transparent"`.
    const layer = tintLayer(container);
    expect(layer).toBeDefined();
    expect(layer?.style.background).toBe("transparent");

    act(() => {
      fixture.emit("vessel.flight", { externalTemperature: 1000 });
    });
    await waitFor(() => expect(sampled(fixture, "vessel.flight")).toBeTruthy());
    expect(
      sampled(fixture, "vessel.flight")?.externalTemperature,
    ).toMatchObject({ magnitude: 1000 });

    // Reentry heat is in the store and the tint stays transparent:
    // `externalTempTint` type-checks for a raw `number` and the wire carries a
    // `Value<"K">`, so the "no signal" branch is the only branch reachable.
    // Absence is therefore indistinguishable from every temperature there is.
    expect(tintLayer(container)?.style.background).toBe("transparent");
  });
});
