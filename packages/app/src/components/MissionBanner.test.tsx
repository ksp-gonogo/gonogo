import {
  StubTransport,
  TelemetryClient,
  TelemetryProvider,
  TimelineStore,
  ViewClock,
} from "@ksp-gonogo/sitrep-client";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@ksp-gonogo/test-utils";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { axe } from "../test/axe";
import { MissionBanner } from "./MissionBanner";

/**
 * Mounts a real `TelemetryProvider` (`TelemetryClient` + `TimelineStore`
 * over a `StubTransport`) around a genuine, live `ViewClock`, the same
 * shape `__tests__/flight-outcome-banner.test.tsx` uses. Feeding the clock
 * directly via `clock.observeSample(validAt, deliveredAt)`: the exact call
 * `TimelineStore.ingest` makes on every sample, for every topic, regardless
 * of who's listening, is the correct low-level equivalent of "a UT-bearing
 * sample landed on the wire", without inventing an unrelated fake topic
 * just to route one through. `emitRoster` carries `commandCentre.roster`
 * for `VantageControl` to subscribe to.
 */
function setupTelemetryStream() {
  const transport = new StubTransport();
  const client = new TelemetryClient(transport);
  const clock = new ViewClock();
  const store = new TimelineStore(clock);

  function Provider({ children }: { children: ReactNode }) {
    return (
      <TelemetryProvider
        client={client}
        store={store}
        carriedChannels={["commandCentre.roster"]}
      >
        {children}
      </TelemetryProvider>
    );
  }

  return {
    advanceTo: (ut: number) => clock.observeSample(ut, ut),
    emitRoster: (roster: unknown) =>
      transport.emit("commandCentre.roster", roster),
    Provider,
  };
}

const MULTI_ROSTER = [
  { id: "ksc", displayName: "KSC", kind: "GroundStation", active: true },
  {
    id: "ground:gs1",
    displayName: "Ground Station 1",
    kind: "GroundStation",
    active: true,
  },
];

describe("MissionBanner", () => {
  it("shows the vantage control and an em dash for the time before any sample lands", () => {
    const fixture = setupTelemetryStream();
    render(
      <fixture.Provider>
        <MissionBanner />
      </fixture.Provider>,
    );

    expect(
      screen.getByRole("button", { name: "Command centre vantage: ksc" }),
    ).toBeInTheDocument();
    expect(screen.getByText(NULL_DISPLAY)).toBeInTheDocument();
  });

  it("shows a Y# D# in-game time once a sample lands, and updates live as UT advances", async () => {
    const fixture = setupTelemetryStream();
    render(
      <fixture.Provider>
        <MissionBanner />
      </fixture.Provider>,
    );

    // formatKspDate(98_557) === "Y1 D5 03:22:37" (see ui-kit's own fixture).
    fixture.advanceTo(98_557);
    await waitFor(() => {
      expect(screen.getByText("Y1 D5 03:22:37")).toBeInTheDocument();
    });

    // formatKspDate(20_560_520) === "Y3 D100 05:15:20".
    fixture.advanceTo(20_560_520);
    await waitFor(() => {
      expect(screen.getByText("Y3 D100 05:15:20")).toBeInTheDocument();
    });
    expect(screen.queryByText("Y1 D5 03:22:37")).toBeNull();
  });

  it("exposes the banner as a single labelled group, not a live region", () => {
    const fixture = setupTelemetryStream();
    render(
      <fixture.Provider>
        <MissionBanner />
      </fixture.Provider>,
    );

    const banner = screen.getByRole("group", { name: "Mission status" });
    expect(banner.getAttribute("aria-live")).toBeNull();
    expect(banner.getAttribute("role")).not.toBe("status");
  });

  it("marks KSC as home and keeps the dropdown affordance even with only one active centre", async () => {
    const fixture = setupTelemetryStream();
    render(
      <fixture.Provider>
        <MissionBanner />
      </fixture.Provider>,
    );
    act(() => {
      fixture.emitRoster([
        { id: "ksc", displayName: "KSC", kind: "GroundStation", active: true },
      ]);
    });

    const trigger = await screen.findByRole("button", {
      name: "Command centre vantage: KSC (home)",
    });
    expect(trigger).toHaveAttribute("aria-haspopup", "listbox");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("Home")).toBeInTheDocument();

    // Still opens, with the one centre offered.
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(screen.getAllByRole("option")).toHaveLength(1);
  });

  it("lists every active centre and re-points the vantage on selection", async () => {
    const fixture = setupTelemetryStream();
    render(
      <fixture.Provider>
        <MissionBanner />
      </fixture.Provider>,
    );
    act(() => {
      fixture.emitRoster(MULTI_ROSTER);
    });

    const trigger = await screen.findByRole("button", {
      name: "Command centre vantage: KSC (home)",
    });
    fireEvent.click(trigger);

    const listbox = screen.getByRole("listbox");
    const options = within(listbox).getAllByRole("option");
    expect(options).toHaveLength(2);
    // Home marking sits on KSC's option, not Ground Station 1's.
    const kscOption = within(listbox)
      .getByText("KSC")
      .closest('[role="option"]');
    const gs1Option = within(listbox)
      .getByText("Ground Station 1")
      .closest('[role="option"]');
    expect(kscOption?.textContent).toContain("Home");
    expect(gs1Option?.textContent).not.toContain("Home");

    fireEvent.pointerDown(within(listbox).getByText("Ground Station 1"));

    // Closed, and the trigger now reflects the new vantage without the home marker.
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(
      await screen.findByRole("button", {
        name: "Command centre vantage: Ground Station 1",
      }),
    ).toBeInTheDocument();
  });

  it("has no accessible violations closed or open", async () => {
    const fixture = setupTelemetryStream();
    const { container } = render(
      <fixture.Provider>
        <MissionBanner />
      </fixture.Provider>,
    );
    act(() => {
      fixture.emitRoster(MULTI_ROSTER);
    });
    const trigger = await screen.findByRole("button", {
      name: "Command centre vantage: KSC (home)",
    });
    expect(await axe(container)).toHaveNoViolations();

    fireEvent.click(trigger);
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });
});
