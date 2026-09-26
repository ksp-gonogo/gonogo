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
 * What `undefined` means at each of ShipMap's read sites:
 *
 *   - `vessel.parts` absent: the "waiting" placeholder and no diagram, the one
 *     absence the operator sees
 *   - `vessel.control.throttle` absent: coerced to zero, so an active engine
 *     draws no flame, identical to a confirmed idle throttle
 *   - `vessel.thermal.hottestPart.name` absent: no "hot:" tag
 *   - `vessel.flight.externalTemperature` absent: no ambient tint, identical to
 *     a comfortable 300 K
 *
 * `useTopology` also folds a tombstone into the pending placeholder.
 */

const TOPOLOGY = fuellinePrelaunch["v.topology"] as VesselTopology;

/** The sidecar's three active engines, in the `vessel.parts` wire's own shape. */
const PART_LIVE = new Map<number, PartLiveWireInput>(
  Object.entries(fuellinePrelaunchPartState as Record<string, unknown>)
    .filter(([key]) => key !== "_comment")
    .map(([flightId, modules]) => [
      Number(flightId),
      {
        partState: {
          seq: 0,
          modules: Array.isArray(modules) ? (modules as PartStateModule[]) : [],
        },
      },
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
  // The domain-free half of the copy: the whole sentence names the legacy data source, which `uplink-boundary` reads as a mod reference.
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

    // The honest read of absence, and the only one of the four the operator sees.
    expect(screen.getByText(PLACEHOLDER_WAITING)).toBeTruthy();
    // Named-element absence: the diagram is what must not be there.
    expect(screen.queryByLabelText("Ship diagram")).toBeNull();
    expect(flameCount(container)).toBe(0);
    // The header meta row belongs to the diagram branch.
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

    // A truthy record with zero parts takes the second placeholder.
    await waitFor(() =>
      expect(screen.getByText("Vessel has no parts.")).toBeTruthy(),
    );
    expect(screen.queryByText(PLACEHOLDER_WAITING)).toBeNull();
  });

  it("a whole-topic tombstone falls back to the WAITING placeholder, not the empty one", async () => {
    const { fixture } = mount();

    // A real vessel first, so the tombstone is provably delivered.
    act(() => {
      fixture.emit("vessel.parts", VESSEL_PARTS_WIRE);
    });
    await waitFor(() =>
      expect(screen.getByLabelText("Ship diagram")).toBeTruthy(),
    );

    act(() => {
      fixture.emit("vessel.parts", null);
    });

    // A confirmed "no value" reads as "nothing has arrived", so a vessel that went away reads as a data-source problem.
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

/** What the store holds for `topic`, independent of what the widget drew: the delivery proof for a read that never reaches the DOM. */
function sampled(fixture: ReturnType<typeof mount>["fixture"], topic: string) {
  const payload = fixture.store.sample(
    topic,
    fixture.store.currentFrame(),
  )?.payload;
  return typeof payload === "object" && payload !== null
    ? (payload as Record<string, unknown>)
    : undefined;
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

    // Active engines and no `vessel.control`: throttle is coerced to 0 and the flame gate closes.
    expect(flameCount(container)).toBe(0);

    act(() => {
      fixture.emit("vessel.control", controlWire(0.5));
    });

    // The store holds a real half throttle.
    await waitFor(() =>
      expect(sampled(fixture, "vessel.control")).toBeTruthy(),
    );
    expect(sampled(fixture, "vessel.control")?.throttle).toMatchObject({
      magnitude: 0.5,
    });

    // Still no flame: the wire carries a wrapped `Value<"ratio">`, which `typeof throttleRaw === "number"` rejects, so the absence branch is the only one reachable.
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

    // No `throttle` field, a record with one, and no record: three states, one picture.
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

    // Absence renders no tag: a diagram with no hottest part rather than an unknown one.
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
      // A record without the nested part: indistinguishable from the channel never speaking.
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

    // Reentry heat in the store and still transparent: `externalTempTint` checks for a raw number and the wire carries `Value<"K">`.
    expect(tintLayer(container)?.style.background).toBe("transparent");
  });
});
