/**
 * The widget renders, and the delayed states are visible ON SCREEN.
 *
 * The arrival rules are unit-tested where they live; what only a render shows
 * is that a message still crossing to this vantage leaks NOTHING, that the
 * operator's own words are held out of the log until they are answered, and
 * that an unanswered one comes back unconfirmed with something to do about it.
 * All three are things a correct pure function can still get wrong in the UI.
 */
import { clearRegistry } from "@ksp-gonogo/core";
import {
  StubTransport,
  TelemetryClient,
  TelemetryProvider,
} from "@ksp-gonogo/sitrep-client";
import { act, render, screen } from "@ksp-gonogo/test-utils";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, describe, expect, it } from "vitest";
import { CommcastWidget } from "./CommcastComponent";
import { CommcastLog } from "./CommcastLog";
import { CommcastLogProvider } from "./CommcastLogContext";
import type { CommsAck, CommsMessage } from "./types";

/**
 * The vantage a bare `StubTransport` gives a screen: none. `useObservedVantage`
 * has had no frame, so the widget reads at an unnamed vantage, which is the
 * state every fresh page load is in for its first frames.
 */
const NOWHERE = undefined;

const JEB = {
  stationKey: "pilot-1",
  name: "Jeb",
  seat: "pilot" as const,
  vantageId: "vessel:ares",
};

const unmounts: Array<() => void> = [];

afterEach(() => {
  for (const unmount of unmounts.splice(0)) unmount();
  clearRegistry();
  localStorage.clear();
});

function makeLog(): CommcastLog {
  const log = new CommcastLog({ screenKey: "screen-under-test" });
  log.setVantage(NOWHERE);
  return log;
}

function renderWidget(log: CommcastLog) {
  const transport = new StubTransport();
  const client = new TelemetryClient(transport);
  const view = render(
    <TelemetryProvider
      client={client}
      carriedChannels={["comms.delay", "comms.link"]}
    >
      <CommcastLogProvider log={log}>
        <CommcastWidget id="w1" config={{}} w={6} h={8} />
      </CommcastLogProvider>
    </TelemetryProvider>,
  );
  unmounts.push(view.unmount);
  return { ...view, transport };
}

/** A message this screen sent, placed straight into its outbox. */
function sent(over: Partial<CommsMessage> = {}): CommsMessage {
  return {
    id: "m1",
    to: ["vessel:ares"],
    from: "ksc",
    authorStationKey: "screen-under-test",
    authorName: "Mission Control",
    authorSeat: "mission-control",
    sentUt: 0,
    lastSentUt: 0,
    attempts: 1,
    separationSeconds: 240,
    kind: "text",
    body: "Ares, Kennedy, do you copy",
    ...over,
  };
}

function ack(over: Partial<CommsAck> = {}): CommsAck {
  return {
    messageId: "m1",
    from: "vessel:ares",
    stationKey: "pilot-1",
    seat: "pilot",
    atUt: -240,
    ...over,
  };
}

describe("Commcast, rendered", () => {
  it("renders an empty log without a crash and without pretending", () => {
    renderWidget(makeLog());
    expect(screen.getByText("Nothing said yet.")).toBeInTheDocument();
  });

  it("says what a send will cost when there is no path to say it over", () => {
    // No delay has arrived on a stub transport and no roster names anyone, so
    // the control says so rather than implying an instant send.
    renderWidget(makeLog());
    expect(
      screen.getByRole("button", { name: /Send \(no path\)/ }),
    ).toBeInTheDocument();
  });

  it("shows NOTHING at all for a message still crossing toward this vantage", () => {
    /*
     * The terminal widget's rule: what has not arrived is absent, not described. Withholding
     * the body while naming the author and printing a countdown still tells
     * this vantage that somebody spoke, a light-time before that could
     * possibly be known here.
     */
    const log = makeLog();
    log.setVantage("ksc");
    log.receiveTransmission({
      ...sent(),
      id: "in-flight",
      to: ["ksc"],
      from: "vessel:ares",
      authorStationKey: JEB.stationKey,
      authorName: JEB.name,
      authorSeat: "pilot",
      sentUt: 1_000_000,
      lastSentUt: 1_000_000,
      body: "SECRET-IN-FLIGHT",
    });
    renderWidget(log);
    expect(screen.queryByText("SECRET-IN-FLIGHT")).not.toBeInTheDocument();
    expect(screen.queryByText("Jeb")).not.toBeInTheDocument();
    expect(screen.getByText("Nothing said yet.")).toBeInTheDocument();
  });

  it("holds the operator's OWN words out of the log until they are answered", () => {
    /*
     * The terminal widget's round trip, on a whole composed line. The words are
     * in the uplink queue and nowhere else: not in the log, and with no
     * verdict on whether they arrived, because nothing has come back.
     */
    const log = makeLog();
    log.replaceForTesting({
      outbox: [{ msg: sent(), acks: [], neverLeft: false }],
    });
    renderWidget(log);
    expect(screen.getByLabelText(/Uplink queue/)).toBeInTheDocument();
    expect(screen.queryByText("unconfirmed")).toBeNull();
    expect(screen.queryByText(/confirmed after/)).toBeNull();
  });

  it("lands them the instant the acknowledgement gets back, and says how long", () => {
    const log = makeLog();
    // Spoken 480 s ago at a 240 s separation, read at the far end the instant
    // it arrived: the acknowledgement has had exactly the return leg to cross.
    log.replaceForTesting({
      outbox: [
        {
          msg: sent({ sentUt: -480, lastSentUt: -480 }),
          acks: [ack({ atUt: -240 })],
          neverLeft: false,
        },
      ],
    });
    renderWidget(log);
    expect(screen.getByText("Ares, Kennedy, do you copy")).toBeInTheDocument();
    expect(screen.getByText(/confirmed after/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Uplink queue/)).toBeNull();
  });

  it("hands them back UNCONFIRMED rather than holding them for the mission", () => {
    // Nobody answered. Past the give-up the author gets their own words back,
    // marked, with the one action attached: send it again.
    const log = makeLog();
    log.replaceForTesting({
      outbox: [
        {
          msg: sent({ sentUt: -600, lastSentUt: -600 }),
          acks: [],
          neverLeft: false,
        },
      ],
    });
    renderWidget(log);
    expect(screen.getByText("Ares, Kennedy, do you copy")).toBeInTheDocument();
    expect(screen.getByText("unconfirmed")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /No path to resend|Send again/ }),
    ).toBeInTheDocument();
  });

  it("counts only an acknowledgement that has REACHED this screen", () => {
    /*
     * One crosses the same separation its message did. Reading the raw list
     * would tell the author their words had been received a light-time before
     * the news could have got back, which is the faster-than-light channel the
     * whole design exists to avoid.
     */
    const log = makeLog();
    log.replaceForTesting({
      outbox: [
        {
          msg: sent({ sentUt: -600, lastSentUt: -600 }),
          // Read at the far end 1 s ago, so the news is still 239 s away.
          acks: [ack({ atUt: -1 })],
          neverLeft: false,
        },
      ],
    });
    renderWidget(log);
    expect(screen.getByText("unconfirmed")).toBeInTheDocument();
    expect(screen.queryByText(/confirmed after/)).toBeNull();
  });

  it("says a message that never left is unconfirmed for a DIFFERENT reason", () => {
    // "Nothing came back" and "nothing went out" call for different
    // judgements, so they must not read the same.
    const log = makeLog();
    log.replaceForTesting({
      outbox: [
        {
          msg: sent({ separationSeconds: null }),
          acks: [],
          neverLeft: true,
        },
      ],
    });
    renderWidget(log);
    expect(
      screen.getByText("unconfirmed, no path when sent"),
    ).toBeInTheDocument();
  });

  it("terminates the log with a no-signal marker on a CONFIRMED link loss", () => {
    const log = makeLog();
    const { transport } = renderWidget(log);
    // Silence is NOT a lost link: a screen that has heard nothing about the
    // route must not accuse its own log of being incomplete.
    expect(screen.queryByText("no signal")).toBeNull();
    act(() => transport.emit("comms.link", { connected: false }));
    expect(screen.getByText("no signal")).toBeInTheDocument();
    act(() => transport.emit("comms.link", { connected: true }));
    expect(screen.queryByText("no signal")).toBeNull();
  });

  it("loses NOTHING when the observed vantage arrives after the log did", () => {
    /*
     * The regression that made the render harness lose whole logs at random.
     * The arrival buffer is rebuilt when this screen learns its own vantage,
     * which happens on every fresh page load, and the pass that rebuilt it
     * used to re-pin every message against the buffer it had just disposed.
     * Those messages were then pinned to something that would never release
     * them and vanished from the log.
     */
    const log = makeLog();
    log.replaceForTesting({
      outbox: [-3000, -2400, -1800, -1200].map((at, i) => ({
        msg: sent({
          id: `m${i}`,
          sentUt: at,
          lastSentUt: at,
          body: `line ${i}`,
        }),
        acks: [],
        neverLeft: false,
      })),
    });
    const { transport } = renderWidget(log);
    // The vantage arriving is what rebuilds the buffer, so this is the edge
    // the defect lived on.
    act(() =>
      transport.emit("comms.link", { connected: true }, { vantage: "ksc" }),
    );
    for (let i = 0; i < 4; i++) {
      expect(screen.getByText(`line ${i}`)).toBeInTheDocument();
    }
  });

  it("has no accessibility violations", async () => {
    const log = makeLog();
    log.replaceForTesting({
      outbox: [
        {
          msg: sent({ sentUt: -600, lastSentUt: -600 }),
          acks: [],
          neverLeft: false,
        },
      ],
    });
    const { container } = renderWidget(log);
    await expectNoA11yViolations(container);
    await act(async () => {});
  });
});
