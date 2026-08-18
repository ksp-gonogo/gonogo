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
