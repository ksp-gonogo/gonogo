import {
  StubTransport,
  TelemetryClient,
  TelemetryProvider,
  TimelineStore,
  ViewClock,
} from "@ksp-gonogo/sitrep-client";
import { CommsDelaySource, value } from "@ksp-gonogo/sitrep-sdk";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@ksp-gonogo/test-utils";
import { NULL_DISPLAY, Unit } from "@ksp-gonogo/ui-kit";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { MissionBanner } from "./MissionBanner";

const KSC = "ground:Kerbal Space Center";

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
      transport.emit("commandCentre.roster", roster, { vantage: KSC }),
    Provider,
  };
}

const MULTI_ROSTER = [
  {
    id: KSC,
    displayName: "KSC",
    kind: "GroundStation",
    active: true,
    isHome: true,
  },
  {
    id: "ground:gs1",
    displayName: "Ground Station 1",
    kind: "GroundStation",
    active: true,
    isHome: false,
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
      screen.getByRole("button", { name: "Command centre vantage: Unknown" }),
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
        {
          id: KSC,
          displayName: "KSC",
          kind: "GroundStation",
          active: true,
          isHome: true,
        },
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
    await expectNoA11yViolations(container);

    fireEvent.click(trigger);
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    await expectNoA11yViolations(container);
  });
});

const GS1 = "ground:gs1";
const CRAFT = "vessel:abc-123";

/**
 * A provider handed no `store`, so it builds the production one and feeds its
 * `DelayAuthority` from `comms.delay`: the header's delay has to come from that
 * authority, and a fixture store would own a clock delay nothing else computes.
 */
function setupDelayedStream() {
  const transport = new StubTransport();
  const client = new TelemetryClient(transport);

  function Provider({ children }: { children: ReactNode }) {
    return (
      <TelemetryProvider
        client={client}
        carriedChannels={[
          "commandCentre.roster",
          "comms.link",
          "comms.delay",
          "spaceCenter.scene",
        ]}
      >
        {children}
      </TelemetryProvider>
    );
  }

  const emit = (
    topic: string,
    payload: unknown,
    vantage: string,
    validAt = 0,
  ) =>
    act(() => {
      transport.emit(topic, payload, {
        vantage,
        validAt,
        deliveredAt: validAt,
      });
    });

  /**
   * The link as the mod publishes it, every tick rather than once: a sample at
   * `ut` and another two light-times later, so the view clock's confirmed edge
   * sits between them and the reading is current rather than held.
   */
  const linkAt = (
    connected: boolean,
    ut: number,
    seconds: number,
    vantage: string,
  ) => {
    emit("comms.link", { connected }, vantage, ut);
    emit("comms.link", { connected }, vantage, ut + 2 * seconds);
  };

  return {
    client,
    transport,
    Provider,
    emit,
    linkAt,
    /**
     * A craft in flight, observed from `vantage`, at `seconds` from home, as of
     * `ut`.
     *
     * The link is published only once the delay field is on screen: a
     * `StubTransport` emit is subscription-gated, and the field that reads
     * `comms.link` mounts on the frame after the scene says Flight.
     */
    flyAt: async (seconds: number, vantage = KSC, ut = 0) => {
      emit("commandCentre.roster", MULTI_ROSTER, vantage, ut);
      emit("spaceCenter.scene", { scene: "Flight" }, vantage, ut);
      emit(
        "comms.delay",
        { oneWaySeconds: seconds, source: CommsDelaySource.SignalDelay },
        vantage,
        ut,
      );
      await screen.findByText("Delay");
      linkAt(true, ut, seconds, vantage);
    },
  };
}

/** The value beside the header's delay caption, or null when there is none. */
function delayValue(): HTMLElement | null {
  return (screen.queryByText("Delay")?.nextElementSibling ??
    null) as HTMLElement | null;
}

/** What `<Unit>` itself draws for `seconds`, to compare the header against. */
function unitMarkup(seconds: number): string {
  const { container, unmount } = render(<Unit value={value("s", seconds)} />);
  const html = container.innerHTML;
  unmount();
  return html;
}

describe("MissionBanner signal delay", () => {
  it("shows nothing when there is no active vessel", async () => {
    const fixture = setupDelayedStream();
    render(
      <fixture.Provider>
        <MissionBanner />
      </fixture.Provider>,
    );
    fixture.emit("commandCentre.roster", MULTI_ROSTER, KSC);
    fixture.emit("spaceCenter.scene", { scene: "SpaceCenter" }, KSC);
    fixture.emit(
      "comms.delay",
      { oneWaySeconds: 187.4, source: CommsDelaySource.SignalDelay },
      KSC,
    );
    fixture.emit("comms.link", { connected: true }, KSC);

    await screen.findByRole("button", {
      name: "Command centre vantage: KSC (home)",
    });
    await act(async () => {});
    expect(screen.queryByText("Delay")).toBeNull();
    expect(screen.queryByText(/signal delay/i)).toBeNull();
  });

  it("renders the delay from the observing home centre through Unit", async () => {
    const atDelay = unitMarkup(187.4);
    const fixture = setupDelayedStream();
    const { container } = render(
      <fixture.Provider>
        <MissionBanner />
      </fixture.Provider>,
    );
    await fixture.flyAt(187.4);

    await waitFor(() => {
      expect(delayValue()?.innerHTML).toContain(atDelay);
    });
    expect(delayValue()?.textContent).toMatch(/^Signal delay/);
    // The strip stays a single labelled group: a delay moving every frame must
    // not announce itself.
    expect(delayValue()?.closest("[aria-live]")).toBeNull();
    expect(delayValue()?.closest('[role="status"]')).toBeNull();
    await expectNoA11yViolations(container);
  });

  it("says disconnected when there is no path, never a zero or the held delay", async () => {
    const atDelay = unitMarkup(187.4);
    const fixture = setupDelayedStream();
    render(
      <fixture.Provider>
        <MissionBanner />
      </fixture.Provider>,
    );
    await fixture.flyAt(187.4);
    await waitFor(() => {
      expect(delayValue()?.innerHTML).toContain(atDelay);
    });

    fixture.emit("comms.delay", { source: CommsDelaySource.None }, KSC, 1000);
    fixture.linkAt(false, 1000, 187.4, KSC);

    await waitFor(() => {
      expect(delayValue()?.textContent).toBe("Signal delay: disconnected");
    });
    expect(delayValue()?.innerHTML).not.toContain(atDelay);
    expect(delayValue()?.innerHTML).not.toContain(unitMarkup(0));
  });

  it("follows the command centre selection", async () => {
    const atDelay = unitMarkup(187.4);
    const fixture = setupDelayedStream();
    render(
      <fixture.Provider>
        <MissionBanner />
      </fixture.Provider>,
    );
    await fixture.flyAt(187.4);
    await waitFor(() => {
      expect(delayValue()?.innerHTML).toContain(atDelay);
    });

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Command centre vantage: KSC (home)",
      }),
    );
    fireEvent.pointerDown(
      within(screen.getByRole("listbox")).getByText("Ground Station 1"),
    );
    // The frames arriving from the new centre are what moves the readout.
    await fixture.flyAt(187.4, GS1, 1000);

    // `comms.delay` is the home centre's light-time. Nothing on the wire says
    // how far Ground Station 1 is, so the header must not quote home's figure
    // as if it were.
    await waitFor(() => {
      expect(delayValue()?.textContent).toContain(
        "Signal delay from this command centre is not reported",
      );
    });
    expect(delayValue()?.innerHTML).not.toContain(atDelay);
  });

  it("reads zero once the selected centre is the craft itself", async () => {
    const atDelay = unitMarkup(187.4);
    const atZero = unitMarkup(0);
    const fixture = setupDelayedStream();
    render(
      <fixture.Provider>
        <MissionBanner />
      </fixture.Provider>,
    );
    await fixture.flyAt(187.4);
    await waitFor(() => {
      expect(delayValue()?.innerHTML).toContain(atDelay);
    });

    act(() => {
      fixture.client.setVantage(CRAFT);
    });
    // Two samples, because one is not a timeline: the subject has to be
    // readable at view time before the session knows it is standing on it.
    for (const validAt of [0, 2 * 187.4]) {
      act(() => {
        fixture.transport.emit(
          "vessel.orbit",
          {
            referenceBodyIndex: 1,
            sma: 700_000,
            ecc: 0.01,
            inc: 0,
            lan: 0,
            argPe: 0,
            meanAnomalyAtEpoch: 0,
            epoch: 10,
            mu: 3.5316e12,
            meta: { source: CRAFT, quality: 0 },
          },
          { validAt, deliveredAt: validAt, vantage: CRAFT },
        );
      });
    }

    await waitFor(() => {
      expect(delayValue()?.innerHTML).toContain(atZero);
    });
  });
});
