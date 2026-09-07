import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { describe, expect, it } from "vitest";
import type { CommandDelayHandle } from "./CommandDelay/CommandDelay";
import {
  DelayRailProvider,
  useActiveHandles,
} from "./CommandDelay/DelayRailContext";
import type { InFlightCommandLike } from "./CommandDelay/toInFlightListItems";
import { usePanelDelay } from "./CommandDelay/usePanelDelay";
import { Panel, PanelProviders } from "./Panel";

const IN_FLIGHT: InFlightCommandLike[] = [
  {
    id: "a",
    label: "Launch",
    command: "ksp.launch",
    reachEtaSeconds: 5,
    replyEtaSeconds: 9,
    predictedPhase: "in-transit",
  },
];

const HANDLE: CommandDelayHandle = {
  inFlight: IN_FLIGHT,
  shape: "discrete",
  effectiveDelaySeconds: 5,
};

/** A command widget's body: contributes its delay handle with usePanelDelay
 * (as a real widget hands `useCommand(...)`'s handle across), no explicit prop
 * to the rail. */
function CommandBody() {
  usePanelDelay(HANDLE);
  return <div>controls</div>;
}

/**
 * The rail travels WITH the header, rather than merely being pinned at the same
 * edge by a mechanism of its own.
 *
 * Both were always visible at the panel's top, the rail in the container's own
 * band and the header sticky inside the scroller, and they stayed adjacent by
 * arithmetic: two pinned boxes that happened to add up. These pin the thing that
 * makes it structural instead, one sticky element holding both, so nothing can
 * move one without moving the other.
 *
 * jsdom runs no layout, so what is asserted is the containment and the
 * declaration. The pixels are in the scroll render.
 */
describe("the rail travels with the header", () => {
  it("puts the rail and the header in ONE sticky element inside the scroller", () => {
    render(
      <DelayRailProvider>
        <Panel panelTitle="Nav">
          <CommandBody />
        </Panel>
      </DelayRailProvider>,
    );
    const scroller = document.querySelector("[data-panel-body]") as HTMLElement;
    const unit = document.querySelector(
      "[data-panel-sticky-top]",
    ) as HTMLElement;
    expect(scroller.firstElementChild).toBe(unit);
    expect(getComputedStyle(unit).position).toBe("sticky");
    // Both halves, in that order: the band above the title.
    const rail = unit.querySelector("[data-panel-rail-frame]") as HTMLElement;
    const header = unit.querySelector("[data-panel-header]") as HTMLElement;
    expect(rail).not.toBeNull();
    expect(header).not.toBeNull();
    expect(
      rail.compareDocumentPosition(header) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("keeps the band on a HEADLESS panel, where there is no header to travel with", () => {
    // The delay rail is a property of being a widget, not of having migrated to
    // `panelTitle`. An unmigrated widget has no header and no scroller of the
    // panel's own, so the rail stays the container's first child and the band
    // stays the container's top inset, exactly as before.
    render(
      <DelayRailProvider>
        <Panel>
          <CommandBody />
        </Panel>
      </DelayRailProvider>,
    );
    expect(document.querySelector("[data-panel-sticky-top]")).toBeNull();
    const frame = document.querySelector(
      "[data-panel-rail-frame]",
    ) as HTMLElement;
    expect(frame).not.toBeNull();
    expect(frame.parentElement?.firstElementChild).toBe(frame);
  });

  it("does not let body content read through the rail", () => {
    // The sticky HEADER is transparent on purpose and the scroll glow is its
    // backing, which is fine for a title. The rail is a reading, and content
    // ghosting through a reading is a reading that can be misread, so its band
    // carries a fully opaque base of its own.
    render(
      <DelayRailProvider>
        <Panel panelTitle="Nav">
          <CommandBody />
        </Panel>
      </DelayRailProvider>,
    );
    const frame = document.querySelector(
      "[data-panel-rail-frame]",
    ) as HTMLElement;
    expect(getComputedStyle(frame).background).toContain(
      "--color-surface-panel",
    );
  });
});

describe("Panel.Delay wiring", () => {
  it("renders the delay rail as the first in-flow child of the body, above the header", () => {
    // The delay store is provided ABOVE the Panel (as GridItemContent does in
    // the app), so usePanelDelay in the widget body reaches it and the rail reads
    // it back.
    render(
      <DelayRailProvider>
        <Panel panelTitle="Nav">
          <CommandBody />
        </Panel>
      </DelayRailProvider>,
    );
    // v3: the rail renders the discrete handle as the height-graph strip, whose
    // accessible name starts "In-flight commands" (with an "N in flight" tail).
    const rail = screen.getByLabelText(/^In-flight commands/);
    const title = screen.getByText("Nav");
    // Rail precedes the header/title in DOM order (first child of the scroller).
    expect(
      rail.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("renders no rail element for a panel with no command in flight (DOM unchanged)", () => {
    render(
      <Panel panelTitle="Nav">
        <div>static body</div>
      </Panel>,
    );
    expect(document.querySelector("[data-panel-rail]")).toBeNull();
    expect(screen.queryByLabelText("In-flight commands")).toBeNull();
  });

  it("Panel.Delay and Panel.Providers are attached to the compound component", () => {
    expect(Panel.Delay).toBeTypeOf("function");
    expect(Panel.Providers).toBe(PanelProviders);
  });

  it("usePanelDelay + the rail read a DelayRailProvider provided above the Panel (the GridItemContent pattern)", () => {
    function Probe() {
      const active = useActiveHandles();
      return <output data-testid="count">{active.length}</output>;
    }
    // The delay store lives ABOVE the widget (app-side GridItemContent), NOT in
    // Panel.Providers: usePanelDelay runs in the widget body, above the Panel it
    // returns, so a Panel-held store would be unreachable. A contributor and a
    // reader under the same DelayRailProvider see the handle.
    render(
      <DelayRailProvider>
        <CommandBody />
        <Probe />
      </DelayRailProvider>,
    );
    expect(screen.getByTestId("count")).toHaveTextContent("1");
  });
});
