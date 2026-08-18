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
 * What ShipMap does when `vessel.thermal` stops being current.
 *
 * The decision: the hottest-part ring is withheld. Which part is hottest is a
 * verdict about the craft now, and heat moves between parts while nobody is
 * looking, so a held name draws a bright ring around the part that WAS hottest
 * and leaves the one glowing now unmarked. That is worse than an unmarked
 * diagram, because the ring is an instruction about where to look.
 *
 * Withholding it silently would be almost as bad. A diagram with no ring is
 * exactly what a cool craft draws, so the header tag has to keep speaking: the
 * operator must be able to tell "we no longer know" from "nothing is hot".
 */

const TOPOLOGY = fuellinePrelaunch["v.topology"] as VesselTopology;

const PART_LIVE = new Map<number, PartLiveWireInput>(
  Object.entries(fuellinePrelaunchPartState as Record<string, unknown>)
    .filter(([key]) => key !== "_comment")
    .map(([flightId, modules]) => [
      Number(flightId),
      { partState: { seq: 0, modules: modules as PartStateModule[] } },
    ]),
);

const VESSEL_PARTS_WIRE = topologyToVesselPartsWire(TOPOLOGY, PART_LIVE);

const CARRIED = ["vessel.parts", "vessel.thermal", "vessel.flight"];

const HOTTEST_PART = "liquidEngine2.v2";
const NOT_CURRENT = /hot: no longer current/;

function ringCount(container: HTMLElement): number {
  return container.querySelectorAll('[data-role="highlight-ring"]').length;
}

describe("ShipMap when the thermal reading is not current", () => {
  function mount() {
    const fixture = setupStreamFixture({
      carriedChannels: CARRIED,
      pinnedUt: 0,
    });
    const { container } = render(
      <fixture.Provider>
        <ShipMapComponent id="ship-map-stale" w={8} h={10} />
      </fixture.Provider>,
    );
    return { fixture, container };
  }

  /** A diagram with one part called out as the hottest. */
  async function emitHotCraft(fixture: ReturnType<typeof setupStreamFixture>) {
    act(() => {
      fixture.emit("vessel.parts", VESSEL_PARTS_WIRE);
      fixture.emit("vessel.thermal", {
        hottestPart: { name: HOTTEST_PART, temperature: 900 },
      });
    });
    await waitFor(() =>
      expect(screen.getByText(new RegExp(`hot: ${HOTTEST_PART}`))).toBeTruthy(),
    );
  }

  function loseTheLink(fixture: ReturnType<typeof setupStreamFixture>) {
    act(() => {
      fixture.store.setTransportConnected(false);
      fixture.store.beginFrame();
    });
  }

  it("rings the hottest part while the reading is current", async () => {
    // The control: the ring genuinely draws, so its absence below means
    // something.
    const { fixture, container } = mount();
    await emitHotCraft(fixture);

    expect(ringCount(container)).toBe(1);
    expect(screen.queryByText(NOT_CURRENT)).toBeNull();
  });

  it("drops the ring and SAYS the hottest part is no longer current", async () => {
    const { fixture, container } = mount();
    await emitHotCraft(fixture);

    loseTheLink(fixture);

    await waitFor(() => expect(screen.getByText(NOT_CURRENT)).toBeTruthy());
    expect(ringCount(container)).toBe(0);
    // The stale name itself is gone from the header too, not merely unringed:
    // a named part beside a "no longer current" tag would invite the operator
    // to go on watching it.
    expect(screen.queryByText(new RegExp(`hot: ${HOTTEST_PART}`))).toBeNull();
  });

  it("keeps drawing the diagram, so the tag is the only cue", async () => {
    // The part tree is a fact and stays on screen, which is the whole reason
    // the tag has to say something: nothing else about this render changes.
    const { fixture } = mount();
    await emitHotCraft(fixture);

    loseTheLink(fixture);

    await waitFor(() => expect(screen.getByText(NOT_CURRENT)).toBeTruthy());
    expect(screen.getByLabelText("Ship diagram")).toBeTruthy();
    expect(screen.getByText(/22 parts/)).toBeTruthy();
  });

  it("does not present a withheld verdict as a craft with nothing hot", async () => {
    // An arrived record with no hottest part is a real answer ("nothing stands
    // out"), and it renders no tag at all. The withheld case must not land on
    // that same silence.
    const { fixture } = mount();
    act(() => {
      fixture.emit("vessel.parts", VESSEL_PARTS_WIRE);
      fixture.emit("vessel.thermal", {});
    });
    await waitFor(() =>
      expect(screen.getByLabelText("Ship diagram")).toBeTruthy(),
    );
    expect(screen.queryByText(/hot:/)).toBeNull();

    loseTheLink(fixture);

    // "Nothing stands out" is itself a claim about the craft, so it goes out of
    // date like any other. The tag keys on the reading rather than on the name
    // it carried, which is why this case speaks too.
    await waitFor(() => expect(screen.getByText(NOT_CURRENT)).toBeTruthy());
  });

  it("says nothing about currency before the thermal channel has spoken", async () => {
    // A cold start is not a dropped link.
    const { fixture } = mount();
    act(() => {
      fixture.emit("vessel.parts", VESSEL_PARTS_WIRE);
    });
    await waitFor(() =>
      expect(screen.getByLabelText("Ship diagram")).toBeTruthy(),
    );

    expect(screen.queryByText(/hot:/)).toBeNull();
  });
});
