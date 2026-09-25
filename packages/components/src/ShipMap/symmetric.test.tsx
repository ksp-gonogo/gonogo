import type { PartStateModule, VesselTopology } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import {
  type PartLiveWireInput,
  topologyToVesselPartsWire,
} from "../test/topologyToVesselPartsWire";
import fuellinePrelaunch from "./__fixtures__/fuelline-tester-22parts-prelaunch.json";
import fuellinePrelaunchPartState from "./__fixtures__/fuelline-tester-22parts-prelaunch.partState.json";
import { ShipMapComponent } from "./index";

/**
 * The fuelline tester carries its two Terrier engines in symmetry: same name,
 * same title, different flight ids. Only the one the thermal reading names by
 * id is hottest, so only that one is ringed.
 */

const TOPOLOGY = fuellinePrelaunch["v.topology"] as VesselTopology;

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

const TERRIER_TITLE = 'LV-909 "Terrier" Liquid Fuel Engine';
const TERRIERS = TOPOLOGY.parts.filter((p) => p.title === TERRIER_TITLE);
const HOT_TERRIER = TERRIERS[1];

function rings(container: HTMLElement): Element[] {
  return Array.from(container.querySelectorAll('[data-role="highlight-ring"]'));
}

function mount() {
  const fixture = setupStreamFixture({
    carriedChannels: ["vessel.parts", "vessel.thermal", "vessel.flight"],
    pinnedUt: 0,
    suspendFrames: true,
  });
  const { container } = render(
    <fixture.Provider>
      <ShipMapComponent id="ship-map-symmetric" w={8} h={10} />
    </fixture.Provider>,
  );
  return { fixture, container };
}

describe("ShipMap on a symmetric craft", () => {
  it("has two same-named parts to tell apart", () => {
    expect(TERRIERS).toHaveLength(2);
    expect(TERRIERS[0].flightId).not.toBe(TERRIERS[1].flightId);
  });

  it("rings only the hottest part, not every part sharing its name", async () => {
    const { fixture, container } = mount();
    act(() => {
      fixture.emit("vessel.parts", VESSEL_PARTS_WIRE);
      fixture.emit("vessel.thermal", {
        hottestPart: {
          name: TERRIER_TITLE,
          id: String(HOT_TERRIER.flightId),
          temperature: 900,
        },
      });
    });
    await waitFor(() => expect(screen.getByText(/hot: LV-909/)).toBeTruthy());

    const drawn = rings(container);
    expect(drawn).toHaveLength(1);
    expect(drawn[0].getAttribute("data-part-id")).toBe(
      String(HOT_TERRIER.flightId),
    );
  });

  it("rings nothing when the reading names no part id", async () => {
    // A name alone cannot say which of the two it means, so neither is ringed;
    // the header still names the part.
    const { fixture, container } = mount();
    act(() => {
      fixture.emit("vessel.parts", VESSEL_PARTS_WIRE);
      fixture.emit("vessel.thermal", {
        hottestPart: { name: TERRIER_TITLE, id: null, temperature: 900 },
      });
    });
    await waitFor(() => expect(screen.getByText(/hot: LV-909/)).toBeTruthy());
    expect(rings(container)).toHaveLength(0);
  });
});
