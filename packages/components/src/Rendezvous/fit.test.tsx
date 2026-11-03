import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import { clearReckoners, registerReckoner } from "@ksp-gonogo/sitrep-client";
import { value } from "@ksp-gonogo/sitrep-sdk";
import { registerCoreReckoners } from "@ksp-gonogo/sitrep-sdk/spine";
import { declareTestReckonable } from "@ksp-gonogo/sitrep-sdk/testing";
import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  installRendezvousBox,
  installTextWidths,
  settleRendezvous,
} from "../test/rendezvousBox";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { RendezvousComponent } from "./index";

/**
 * What the figures do when the room beside the circle is short: the range is
 * never taken away by the modelled figure beside it, and a name that does not
 * fit wraps in a band instead of being cut.
 */
let restore: Array<() => void> = [];

beforeEach(() => {
  clearReckoners();
  registerCoreReckoners();
});

afterEach(() => {
  for (const undo of restore) undo();
  restore = [];
  clearActionHandlers();
});

const TEN_KM = /10\.0\sk?m/;

const TARGET = (name: string) => ({
  name,
  kind: 0,
  vesselId: "target-vessel",
  bodyIndex: null,
  relativePosition: { x: 6000, y: 0, z: 8000 },
  relativeVelocity: { x: 30, y: 0, z: 40 },
});

async function mount(
  name: string,
  box: { w: number; h: number },
  instanceId: string,
) {
  restore.push(installRendezvousBox(box), installTextWidths(3));
  const fixture = setupStreamFixture({ pinnedUt: 10, suspendFrames: true });
  const rendered = render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId }}>
        <RendezvousComponent id={instanceId} w={6} h={9} />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  act(() => {
    fixture.emit("vessel.target", TARGET(name));
  });
  await waitFor(() => expect(rendered.container.textContent).toMatch(TEN_KM));
  await settleRendezvous();
  return { fixture, rendered };
}

describe("Rendezvous: the figures beside the circle", () => {
  it("keeps the range drawn when the modelled figure beside it would not fit", async () => {
    declareTestReckonable("vessel.target", "rendezvous");
    registerReckoner("vessel.target", "rendezvous", {
      deps: [],
      reckon: () => ({
        modelled: [{ path: "", basis: "linear-dead-reckoning" }],
        reckon: () => ({
          relativePosition: {
            x: value("m", 7200),
            y: value("m", 0),
            z: value("m", 9600),
          },
        }),
      }),
    });
    const { fixture, rendered } = await mount(
      "Relay",
      { w: 208, h: 230 },
      "fit-range",
    );
    act(() => {
      fixture.store.setTransportConnected(false);
      fixture.store.beginFrame();
    });
    await waitFor(() =>
      expect(rendered.container.textContent).toMatch(/12\.0\sk?m/),
    );
    await settleRendezvous();
    const right = rendered.container.querySelector<HTMLElement>(
      '[data-figure="top-right"]',
    );
    expect(right).not.toBeNull();
    expect(right?.style.visibility).toBe("visible");
    const [range, modelled] = Array.from(
      right?.children ?? [],
    ) as HTMLElement[];
    expect(range.textContent).toMatch(TEN_KM);
    expect(modelled.style.visibility).toBe("hidden");
    expect(modelled.textContent).toMatch(/12\.0\sk?m/);
  });

  it("wraps a name too long for its corner in a band above the circle, whole", async () => {
    const { rendered } = await mount(
      "Rendezvous Target Vessel Number Two",
      { w: 208, h: 230 },
      "fit-name",
    );
    const top = rendered.container.querySelector<HTMLElement>(
      '[data-figure="top"]',
    );
    expect(top).not.toBeNull();
    expect(top?.textContent).toContain("Rendezvous Target Vessel Number Two");
    expect(top?.style.flexWrap).toBe("wrap");
    expect(
      rendered.container.querySelector('[data-figure="top-left"]'),
    ).toBeNull();
    // Nothing on the screen is cut with an ellipsis.
    for (const el of Array.from(
      rendered.container.querySelectorAll<HTMLElement>("[data-figure] *"),
    )) {
      expect(el.style.textOverflow).not.toBe("ellipsis");
    }
  });

  it("keeps the bottom figures in a band of their own under a narrow circle", async () => {
    const { rendered } = await mount("Relay", { w: 150, h: 330 }, "fit-narrow");
    const bottom = rendered.container.querySelector<HTMLElement>(
      '[data-figure="bottom"]',
    );
    expect(bottom).not.toBeNull();
    expect(bottom?.textContent).toContain("CA");
  });

  it("points the range arrow up while the range is opening, which is a negative closing rate", async () => {
    const { rendered } = await mount("Relay", { w: 208, h: 230 }, "fit-sign");
    expect(
      rendered.container.querySelector('[data-range-rate="opening"]'),
    ).not.toBeNull();
    expect(
      rendered.container.querySelector('[data-range-rate="closing"]'),
    ).toBeNull();
  });
});
