import { railTagsForCommand } from "@ksp-gonogo/sitrep-sdk";
import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { describe, expect, it } from "vitest";
import type { CommandDelayHandle } from "./CommandDelay/CommandDelay";
import {
  DelayRailProvider,
  useActiveHandles,
} from "./CommandDelay/DelayRailContext";
import type { InFlightCommandLike } from "./CommandDelay/toInFlightListItems";
import { useRailEntry } from "./CommandDelay/useRailEntry";
import { Panel } from "./Panel";

// Rail axes from the production derivations, so a fixture cannot drift from them.
const RAIL_DISCRETE = railTagsForCommand("vessel.control.setSasMode");

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
  tags: RAIL_DISCRETE,
  effectiveDelaySeconds: 5,
};

/** A widget body contributing a rail entry, no explicit prop to the rail. */
function CommandBody() {
  useRailEntry(HANDLE);
  return <div>controls</div>;
}

/**
 * The rail travels with the header: one sticky element holds both. jsdom runs
 * no layout, so this asserts the containment and the declaration.
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
    // A headless panel still gets the rail, as the container's first child in its top band.
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
    // The header is transparent over the glow, but the rail is a reading, so its band is opaque.
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
    // The delay store is provided above the Panel, so an entry from the widget body reaches it.
    render(
      <DelayRailProvider>
        <Panel panelTitle="Nav">
          <CommandBody />
        </Panel>
      </DelayRailProvider>,
    );
    // The discrete handle renders as the height-graph strip, named "In-flight commands".
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

  it("Panel.Delay is attached to the compound component", () => {
    expect(Panel.Delay).toBeTypeOf("function");
  });

  it("an entry and the rail read a DelayRailProvider provided above the Panel (the GridItemContent pattern)", () => {
    function Probe() {
      const active = useActiveHandles();
      return <output data-testid="count">{active.length}</output>;
    }
    // A contributor and a reader under the same DelayRailProvider, above the Panel, see the handle.
    render(
      <DelayRailProvider>
        <CommandBody />
        <Probe />
      </DelayRailProvider>,
    );
    expect(screen.getByTestId("count")).toHaveTextContent("1");
  });
});
