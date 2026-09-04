/**
 * The widget renders, and the delayed states are visible ON SCREEN.
 *
 * The arrival rules are unit-tested where they live and the grouping in
 * `threads.test.ts`; what only a render shows is that a message still crossing
 * to this vantage leaks NOTHING, that the operator's own words are held out of
 * the log until they are answered, that an unanswered one comes back
 * unconfirmed with something to do about it, and that the send control keeps
 * one size however far away the recipient is. All of those are things a correct
 * pure function can still get wrong in the UI.
 */
import { clearRegistry } from "@ksp-gonogo/core";
import {
  StubTransport,
  TelemetryClient,
  TelemetryProvider,
} from "@ksp-gonogo/sitrep-client";
import { setupStreamFixture } from "@ksp-gonogo/sitrep-sdk/testing";
import { act, render, screen } from "@ksp-gonogo/test-utils";
import {
  expectNoA11yViolations,
  visibleText,
} from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
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

/** Everything the widget declares, so nothing it reads is left unfed. */
const TOPICS = [
  "commandCentre.roster",
  "commandCentre.separation",
  "comms.delay",
  "comms.link",
];

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
    <TelemetryProvider client={client} carriedChannels={TOPICS}>
      <CommcastLogProvider log={log}>
        <CommcastWidget id="w1" config={{}} w={6} h={8} />
      </CommcastLogProvider>
    </TelemetryProvider>,
  );
  unmounts.push(view.unmount);
  return { ...view, transport };
}

/**
 * The same widget over the REAL spine, for the two tests that need a roster and
 * a published separation.
 *
 * A bare `StubTransport` cannot serve either: `useTelemetry` reads the delayed
 * store, and without a `ViewClock` and a frame nothing it emits ever matures
 * past `pending`. The fixture is the shipped way to run a widget off the stream
 * and it is what the render harness uses, so the two agree about what a screen
 * with a correspondent looks like.
 */
function renderOnStream(
  log: CommcastLog,
  roster: readonly unknown[],
  /**
   * Separations to publish, one-way seconds. Defaults to the headline pair,
   * four light-minutes to the craft; a test about a NEAR correspondent passes
   * its own, because which of the two delay readings the widget draws is
   * decided off this number.
   */
  pairs: readonly { from: string; to: string; oneWaySeconds: number }[] = [
    { from: "ksc", to: "vessel:ares", oneWaySeconds: 240 },
  ],
) {
  const fixture = setupStreamFixture({ carriedChannels: TOPICS, pinnedUt: 10 });
  const view = render(
    <fixture.Provider>
      <CommcastLogProvider log={log}>
        <CommcastWidget id="w1" config={{}} w={6} h={8} />
      </CommcastLogProvider>
    </fixture.Provider>,
  );
  unmounts.push(view.unmount);
  act(() => {
    fixture.emit("commandCentre.roster", roster, { vantage: "ksc" });
    fixture.emit("commandCentre.separation", { pairs }, { vantage: "ksc" });
    // The pinned frame has to advance onto the sample before the read matures.
    fixture.store.beginFrame();
  });
  return { ...view, fixture };
}

/**
 * The widget opens on the inbox, so a test about a conversation has to open
 * one. Clicked through the real row rather than reached round the UI: which
 * conversation a row leads to is one of the things under test.
 */
async function openConversation(name: string | RegExp) {
  await userEvent.click(await screen.findByRole("button", { name }));
}

/** A message this screen sent, placed straight into its outbox. */
function sent(over: Partial<CommsMessage> = {}): CommsMessage {
  return {
    id: "m1",
    to: ["vessel:ares"],
    from: "ksc",
    authorStationKey: "screen-under-test",
    authorName: "Kennedy Flight",
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
  it("opens on the INBOX, not on a conversation", async () => {
    /*
     * The whole point of replacing the dropdown. A screen that opened straight
     * into a thread would be the old widget with the picker hidden, and the
     * operator would have no way to see that two correspondences are separate.
     */
    renderWidget(makeLog());
    expect(await screen.findByText(/No conversations/)).toBeInTheDocument();
    // The composer belongs to a conversation, so it is not on this screen.
    expect(screen.queryByLabelText("Message")).toBeNull();
  });

  it("lists one row per conversation, and says which has words still out", async () => {
    const log = makeLog();
    log.replaceForTesting({
      inbox: [
        sent({
          id: "heard",
          from: "ground:woomera",
          to: ["ksc"],
          authorName: "Woomera Range",
          sentUt: -600,
          lastSentUt: -600,
          separationSeconds: 12,
          body: "Kennedy, Woomera. Tracking is locked.",
        }),
      ],
      outbox: [{ msg: sent(), acks: [], neverLeft: false }],
    });
    renderWidget(log);
    const rows = await screen.findAllByRole("button", {
      name: /Tracking is locked|do you copy/,
    });
    expect(rows).toHaveLength(2);
    // Something is still crossing to the craft, so that conversation is first
    // and says so; the settled one does not.
    expect(rows[0]).toHaveAccessibleName(/do you copy/);
    expect(rows[0]).toHaveAccessibleName(/1 out/);
    expect(rows[1]).not.toHaveAccessibleName(/out/);
  });

  it("opens a conversation with no recipient control and a way back", async () => {
    const log = makeLog();
    log.replaceForTesting({
      inbox: [
        sent({
          id: "heard",
          from: "vessel:ares",
          to: ["ksc"],
          authorName: JEB.name,
          authorSeat: "pilot",
          sentUt: -600,
          lastSentUt: -600,
          body: "Kennedy, Ares. Go ahead.",
        }),
      ],
    });
    renderWidget(log);
    await openConversation(/Go ahead/);
    expect(screen.getByText("Kennedy, Ares. Go ahead.")).toBeInTheDocument();
    expect(screen.getByLabelText("Message")).toBeInTheDocument();
    // The control the operator asked to lose. A combobox anywhere in a
    // conversation would be the dropdown back.
    expect(screen.queryByRole("combobox")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Inbox" }));
    expect(screen.getByText(/conversation/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Message")).toBeNull();
  });

  it("keeps the composer INSIDE the console's own border", async () => {
    /*
     * The same claim the terminal widget's suite makes about its own bar, and
     * the reason both were changed at once: the composer used to hang below the
     * frame as a third box in a stack, so the outline contained a column of
     * messages here and a terminal screen there, and the two consoles read as
     * unrelated components. A role query cannot see it, because the composer
     * rendered perfectly well outside.
     */
    const log = makeLog();
    log.replaceForTesting({
      inbox: [
        sent({
          id: "heard",
          from: "vessel:ares",
          to: ["ksc"],
          authorName: JEB.name,
          authorSeat: "pilot",
          sentUt: -600,
          lastSentUt: -600,
          body: "Kennedy, Ares. Go ahead.",
        }),
      ],
    });
    const { container } = renderWidget(log);
    await openConversation(/Go ahead/);

    const frame = container.querySelector("[data-console-frame]");
    expect(frame).not.toBeNull();
    expect(frame?.contains(screen.getByLabelText("Message"))).toBe(true);
    expect(frame?.contains(screen.getByText("Kennedy, Ares. Go ahead."))).toBe(
      true,
    );
  });

  it("keeps the send control one size whatever the delay beside it is", async () => {
    /*
     * The defect the operator named: the label used to carry the round trip,
     * so the same button was two words at the pad and a sentence four
     * light-minutes out. The verb is now all the label ever says, and the
     * figure is a separate reading whose shape the terminal widget's model
     * decides.
     */
    const log = makeLog();
    log.setVantage("ksc");
    renderOnStream(log, [
      { id: "vessel:ares", displayName: "Ares 4", active: true },
    ]);
    await userEvent.click(screen.getByRole("button", { name: /New message/ }));
    await userEvent.click(screen.getByRole("button", { name: /Ares 4/ }));
    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument();
    await act(async () => {});
  });

  it("leaves a long delay to the strip, with no chip saying the same thing", async () => {
    /*
     * The terminal widget's model, verbatim. Four light-minutes out a countdown
     * IS the reading, so the strip carries it and there is no standing chip
     * beside it: the two together said the same separation twice in two shapes
     * and the operator had to work out which was about the message they had
     * just sent.
     */
    const log = makeLog();
    log.setVantage("ksc");
    /*
     * Something actually out, so the strip has a row: it renders nothing at
     * all for an empty set, and a test on an empty conversation would be
     * asserting the absence of both readings and calling it the switch.
     */
    log.replaceForTesting({
      outbox: [{ msg: sent(), acks: [], neverLeft: false }],
    });
    renderOnStream(log, [
      { id: "vessel:ares", displayName: "Ares 4", active: true },
    ]);
    await openConversation(/do you copy/);
    expect(screen.getByLabelText(/Uplink queue/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Signal delay")).toBeNull();
    await act(async () => {});
  });

  it("badges a delay too short to count down, and draws no strip for it", async () => {
    /*
     * The other end of the same switch. A correspondent under a second away has
     * nothing worth counting down to, so the separation shows as a standing
     * reading and the strip stays away. ONE-WAY, because what the operator is
     * waiting on is their words landing; the acknowledgement coming back is a
     * separate wait and doubling the figure quoted them the wrong one.
     */
    const log = makeLog();
    log.setVantage("ksc");
    renderOnStream(
      log,
      [{ id: "ground:woomera", displayName: "Woomera Range", active: true }],
      [{ from: "ksc", to: "ground:woomera", oneWaySeconds: 0.4 }],
    );
    await userEvent.click(screen.getByRole("button", { name: /New message/ }));
    await userEvent.click(
      screen.getByRole("button", { name: /Woomera Range/ }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(visibleText(screen.getByLabelText("Signal delay"))).toContain(
      "~0.4 s",
    );
    expect(screen.queryByLabelText(/Uplink queue/)).toBeNull();
    await act(async () => {});
  });

  it("hangs the delay reading in the console's corner, not in the composer", async () => {
    /*
     * The operator's ruling, and the defect it was about: this console put the
     * reading INSIDE the composer, beside Send, while the terminal widget it
     * was converged with pinned it in the console's top-right corner. Two
     * consoles built from the same parts answered the same question in two
     * places, which is what made the shared frame look like it was doing less
     * than it was: "I like it in the top right corner, please can we just
     * align to that".
     *
     * Structural rather than positional: a role query cannot tell the two
     * apart, because both drew a perfectly good badge.
     */
    const log = makeLog();
    log.setVantage("ksc");
    const { container } = renderOnStream(
      log,
      [{ id: "ground:woomera", displayName: "Woomera Range", active: true }],
      [{ from: "ksc", to: "ground:woomera", oneWaySeconds: 0.4 }],
    );
    await userEvent.click(screen.getByRole("button", { name: /New message/ }));
    await userEvent.click(
      screen.getByRole("button", { name: /Woomera Range/ }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Open" }));

    const badge = screen.getByLabelText("Signal delay");
    const corner = container.querySelector("[data-console-corner]");
    expect(corner).not.toBeNull();
    expect(corner?.contains(badge)).toBe(true);
    // And out of the row the operator types into: a reading beside Send is a
    // reading that moves with the control it is meant to be a cost of.
    expect(
      screen
        .getByRole("button", { name: "Send" })
        .parentElement?.contains(badge),
    ).toBe(false);
    await act(async () => {});
  });

  it("says over the composer when there is no path to send over", async () => {
    /*
     * No delay has arrived on a stub transport, so the bar's own outline turns
     * and the chip says why, rather than the refusal reaching the operator only
     * after they press.
     */
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
    await openConversation(/do you copy/);
    expect(screen.getByText("NO PATH")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument();
  });

  it("takes a list of recipients, and refuses the group case rather than faking it", async () => {
    /*
     * The envelope has always carried a list and the picker toggles, so
     * growing groups is additive. What is NOT built is group DELIVERY: the
     * author's separation is one frozen figure and the acknowledgement window
     * is measured off it, so a second name is refused where the operator can
     * see why.
     */
    const log = makeLog();
    log.setVantage("ksc");
    renderOnStream(log, [
      { id: "vessel:ares", displayName: "Ares 4", active: true },
      { id: "ground:woomera", displayName: "Woomera Range", active: true },
    ]);
    await userEvent.click(screen.getByRole("button", { name: /New message/ }));
    await userEvent.click(screen.getByRole("button", { name: /Ares 4/ }));
    expect(screen.getByRole("button", { name: "Open" })).toBeEnabled();
    await userEvent.click(
      screen.getByRole("button", { name: /Woomera Range/ }),
    );
    expect(screen.getByRole("button", { name: "Open" })).toBeDisabled();
    expect(
      screen.getByText("Group delivery is not carried yet"),
    ).toBeInTheDocument();
    await act(async () => {});
  });

  it("shows NOTHING at all for a message still crossing toward this vantage", async () => {
    /*
     * The terminal widget's rule: what has not arrived is absent, not described. Withholding
     * the body while naming the author and printing a countdown still tells
     * this vantage that somebody spoke, a light-time before that could
     * possibly be known here. There is not even a conversation for it to be in.
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
    expect(await screen.findByText(/No conversations/)).toBeInTheDocument();
    expect(screen.queryByText("SECRET-IN-FLIGHT")).not.toBeInTheDocument();
    expect(screen.queryByText("Jeb")).not.toBeInTheDocument();
  });

  it("holds the operator's OWN words out of the log until they are answered", async () => {
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
    await openConversation(/do you copy/);
    expect(screen.getByLabelText(/Uplink queue/)).toBeInTheDocument();
    /*
     * The queue row is labelled with the words, so the body is on screen
     * there. What is absent is the LOG row: no author line, and no verdict
     * either way, because nothing has come back to say anything yet.
     */
    expect(screen.queryByText("Kennedy Flight")).toBeNull();
    expect(screen.queryByText("unconfirmed")).toBeNull();
  });

  it("lands them the instant the acknowledgement gets back, stamped with when", async () => {
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
    await openConversation(/do you copy/);
    expect(screen.getByText("Ares, Kennedy, do you copy")).toBeInTheDocument();
    // The author, and one reading: the instant the confirmation landed here.
    // A sentence about how long it took is what this replaced.
    expect(screen.getByText("Kennedy Flight")).toBeInTheDocument();
    expect(screen.getByText(/^Y1 D1 /)).toBeInTheDocument();
    expect(screen.queryByText(/confirmed after/)).toBeNull();
    expect(screen.queryByLabelText(/Uplink queue/)).toBeNull();
  });

  it("hands them back UNCONFIRMED rather than holding them for the mission", async () => {
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
    await openConversation(/do you copy/);
    expect(screen.getByText("Ares, Kennedy, do you copy")).toBeInTheDocument();
    expect(screen.getByText("unconfirmed")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /No path to resend|Send again/ }),
    ).toBeInTheDocument();
  });

  it("counts only an acknowledgement that has REACHED this screen", async () => {
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
    await openConversation(/do you copy/);
    expect(screen.getByText("unconfirmed")).toBeInTheDocument();
  });

  it("says a message that never left is unconfirmed for a DIFFERENT reason", async () => {
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
    await openConversation(/do you copy/);
    expect(screen.getByText("never left, no path")).toBeInTheDocument();
    expect(screen.queryByText("unconfirmed")).toBeNull();
  });

  it("terminates the log with a no-signal marker on a CONFIRMED link loss", async () => {
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
    const { transport } = renderWidget(log);
    await openConversation(/do you copy/);
    // Silence is NOT a lost link: a screen that has heard nothing about the
    // route must not accuse its own log of being incomplete.
    expect(screen.queryByText("no signal")).toBeNull();
    act(() => transport.emit("comms.link", { connected: false }));
    expect(screen.getByText("no signal")).toBeInTheDocument();
    act(() => transport.emit("comms.link", { connected: true }));
    expect(screen.queryByText("no signal")).toBeNull();
  });

  it("loses NOTHING when the observed vantage arrives after the log did", async () => {
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
    await openConversation(/line 3/);
    for (let i = 0; i < 4; i++) {
      expect(screen.getByText(`line ${i}`)).toBeInTheDocument();
    }
  });

  it("has no accessibility violations, in the inbox and in a conversation", async () => {
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
    await openConversation(/do you copy/);
    await expectNoA11yViolations(container);
    await act(async () => {});
  });
});
