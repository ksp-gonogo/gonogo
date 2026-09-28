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
 * What ShipMap does when `vessel.thermal` stops being current: the
 * hottest-part ring is withheld, since it tells the operator where to look
 * now. The header tag keeps the last hottest part with its temperature, which
 * Unit marks as held.
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

const HOTTEST_PART = "liquidEngine2.v2";
const HOTTEST_PART_ID = "965970713";
const CAPTION = /last contact/i;

function heldMarks(): NodeListOf<Element> {
  return document.querySelectorAll("[data-held-mark]");
}

function hotTag(): HTMLElement {
  return screen.getByText(new RegExp(`hot: ${HOTTEST_PART}`));
}

function ringCount(container: HTMLElement): number {
  return container.querySelectorAll('[data-role="highlight-ring"]').length;
}

describe("ShipMap when the thermal reading is held", () => {
  function mount() {
    const fixture = setupStreamFixture({
      pinnedUt: 0,
      suspendFrames: true,
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
        hottestPart: {
          name: HOTTEST_PART,
          id: HOTTEST_PART_ID,
          internalTemp: 900,
        },
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
    // The control: the ring genuinely draws, so its absence below means something.
    const { fixture, container } = mount();
    await emitHotCraft(fixture);

    expect(ringCount(container)).toBe(1);
    expect(hotTag().textContent).toMatch(/900/);
    expect(heldMarks()).toHaveLength(0);
  });

  it("drops the ring and marks the held hottest part's temperature", async () => {
    const { fixture, container } = mount();
    await emitHotCraft(fixture);

    loseTheLink(fixture);

    await waitFor(() => expect(ringCount(container)).toBe(0));
    // The tag keeps the last hottest part; Unit's held mark and spoken caption on its temperature say it is held.
    expect(hotTag().textContent).toMatch(/900/);
    expect(hotTag().querySelector("[data-held-mark]")).not.toBeNull();
    expect(hotTag().querySelector("[data-unit-currency]")).not.toBeNull();
    expect(screen.queryByText(CAPTION)).toBeNull();
  });

  it("keeps drawing the diagram, so the tag is the only cue", async () => {
    // The part tree is a fact and stays, so nothing but the tag changes.
    const { fixture } = mount();
    await emitHotCraft(fixture);

    loseTheLink(fixture);

    await waitFor(() => expect(heldMarks().length).toBeGreaterThan(0));
    expect(screen.getByLabelText("Ship diagram")).toBeTruthy();
    expect(screen.getByText(/22 parts/)).toBeTruthy();
  });

  it("writes no caption of its own when a craft with nothing hot goes held", async () => {
    // No hottest part is a real answer with no tag, and holding it adds no widget-written wording.
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

    await waitFor(() =>
      expect(fixture.store.sampleReading("vessel.thermal").state).toBe("stale"),
    );
    expect(screen.queryByText(/hot:/)).toBeNull();
    expect(screen.queryByText(CAPTION)).toBeNull();
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
