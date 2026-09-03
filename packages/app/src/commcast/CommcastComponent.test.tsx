/**
 * The widget renders, and the delayed states are visible ON SCREEN.
 *
 * The reveal rule is unit-tested where it lives; what only a render shows is
 * that a message still crossing to this seat does not leak its BODY, and that
 * the operator is told which of the three states each message is in. Both are
 * things a correct pure function can still get wrong in the UI.
 */
import { clearRegistry, PerfBudget } from "@ksp-gonogo/core";
import {
  StubTransport,
  TelemetryClient,
  TelemetryProvider,
} from "@ksp-gonogo/sitrep-client";
import { act, render, screen } from "@ksp-gonogo/test-utils";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, describe, expect, it } from "vitest";
import { getStationKey } from "../peer/stationPeerId";
import { CommcastWidget } from "./CommcastComponent";
import { CommcastHostProvider } from "./CommcastHostContext";
import { CommcastHostService } from "./CommcastHostService";
import type { CommsParticipant } from "./types";

function findBudget(name: string) {
  return PerfBudget.getAll().find((b) => b.name === name);
}

const PILOT: CommsParticipant = {
  stationKey: "pilot-1",
  name: "Jeb",
  seat: "pilot",
};

/** The same identity the widget posts under, so a test can be its author. */
function localParticipant(): CommsParticipant {
  return {
    stationKey: getStationKey(),
    name: "Mission Control",
    seat: "mission-control",
  };
}

const unmounts: Array<() => void> = [];

afterEach(() => {
  for (const unmount of unmounts.splice(0)) unmount();
  clearRegistry();
  localStorage.clear();
});

function renderWidget(host: CommcastHostService) {
  const transport = new StubTransport();
  const client = new TelemetryClient(transport);
  const view = render(
    <TelemetryProvider
      client={client}
      carriedChannels={["comms.delay", "comms.link"]}
    >
      <CommcastHostProvider service={host}>
        <CommcastWidget id="w1" config={{}} w={6} h={8} />
      </CommcastHostProvider>
    </TelemetryProvider>,
  );
  unmounts.push(view.unmount);
  return { ...view, transport };
}

describe("Commcast, rendered", () => {
  it("renders an empty thread without a crash and without pretending", () => {
    renderWidget(new CommcastHostService());
    expect(screen.getByText("Nothing spoken yet.")).toBeInTheDocument();
  });

  it("offers a composer that says what the send will cost in light-time", () => {
    const host = new CommcastHostService();
    renderWidget(host);
    // No delay has arrived on a stub transport, so the separation is unknown
    // and the control says so rather than implying an instant send.
    expect(
      screen.getByRole("button", { name: /Send \(no path\)/ }),
    ).toBeInTheDocument();
  });

  it("does NOT show the body of someone else's message still in transit", () => {
    // The whole design in one assertion: a message that has not reached this
    // seat must not be readable at it, however cheap it would be to render.
    const host = new CommcastHostService();
    host.post(PILOT, {
      kind: "text",
      body: "SECRET-IN-FLIGHT",
      sentUt: 1_000_000,
      oneWaySeconds: 240,
    });
    renderWidget(host);
    expect(screen.queryByText("SECRET-IN-FLIGHT")).not.toBeInTheDocument();
    expect(screen.getByText(/In transit/)).toBeInTheDocument();
  });

  it("withholds the body of a message spoken where no path reaches here", () => {
    const host = new CommcastHostService();
    host.post(PILOT, {
      kind: "text",
      body: "into the void",
      sentUt: 1000,
      oneWaySeconds: null,
    });
    renderWidget(host);
    expect(screen.getByText(/Never reached you/)).toBeInTheDocument();
    expect(
      screen.getByText("no path from where it was spoken"),
    ).toBeInTheDocument();
    // Somebody said something this seat cannot hear, and that is the fact on
    // screen. The words themselves never crossed and are not shown.
    expect(screen.queryByText("into the void")).not.toBeInTheDocument();
  });

  it("flags the operator's OWN message that reached nobody, in place", () => {
    /*
     * Revealed here, because the author is standing next to it, and flagged
     * rather than filed away: without this an author watches their own words
     * sit in the thread looking delivered while nobody received them.
     */
    const host = new CommcastHostService();
    const me = localParticipant();
    // At UT 0, so it is at-or-before the stub clock's estimate and releases
    // straight away: this test is about how an ARRIVED message is flagged.
    host.post(me, {
      kind: "text",
      body: "anyone there",
      sentUt: 0,
      oneWaySeconds: null,
    });
    renderWidget(host);
    expect(screen.getByText("anyone there")).toBeInTheDocument();
    expect(screen.getByText(/nobody else received this/)).toBeInTheDocument();
  });

  it("terminates the thread with a no-signal marker on a CONFIRMED link loss", () => {
    const host = new CommcastHostService();
    host.post(PILOT, {
      kind: "text",
      body: "hello",
      sentUt: 0,
      oneWaySeconds: null,
    });
    const { transport } = renderWidget(host);

    // Nothing said about the link yet reads as connected, so an unpublished
    // route must not accuse the thread of being incomplete.
    expect(screen.queryByText("no signal")).toBeNull();

    act(() => transport.emit("comms.link", { connected: false }));
    expect(screen.getByText("no signal")).toBeInTheDocument();

    act(() => transport.emit("comms.link", { connected: true }));
    expect(screen.queryByText("no signal")).toBeNull();
  });

  it("says how many messages the thread has dropped, at the head where the gap is", () => {
    const host = new CommcastHostService();
    // Past the host's 500-message cap by three, so the reading is a real drop
    // rather than a number handed in. Filling the cap in one tick is 503
    // commits the broadcast budget rightly objects to; reset it, because the
    // cap is what this test is about and the send rate is not.
    for (let i = 0; i < 503; i++) {
      host.post(PILOT, {
        kind: "text",
        body: `m${i}`,
        sentUt: 0,
        oneWaySeconds: null,
      });
    }
    findBudget("CommcastHostService snapshots/sec")?.reset();
    renderWidget(host);

    const marker = screen.getByText(/dropped at the cap/);
    expect(marker.textContent).toContain("3 earlier messages");
    // At the HEAD: the gap is at the front of the thread, so the marker is
    // the first thing in the list rather than a footnote under the composer.
    const list = marker.parentElement;
    expect(list?.firstElementChild).toBe(marker);
  });

  it("shows no withheld-body placeholder, so nothing in the thread reads as a separator", () => {
    // A message still crossing to this seat renders its author and how long
    // it has to run, and NO body line. The dash that used to stand in for the
    // withheld body read as a rule between messages.
    const host = new CommcastHostService();
    host.post(PILOT, {
      kind: "text",
      body: "still crossing",
      sentUt: 10_000,
      oneWaySeconds: 240,
    });
    renderWidget(host);
    expect(screen.queryByText("still crossing")).toBeNull();
    expect(screen.getByText(/In transit \(1\)/)).toBeInTheDocument();
    expect(screen.queryByText(NULL_DISPLAY)).toBeNull();
  });

  it("has no accessibility violations", async () => {
    const host = new CommcastHostService();
    host.post(PILOT, {
      kind: "text",
      body: "hello",
      sentUt: 1000,
      oneWaySeconds: null,
    });
    const { container } = renderWidget(host);
    await expectNoA11yViolations(container);
    await act(async () => {});
  });
});
