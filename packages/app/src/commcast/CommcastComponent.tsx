import type { ComponentProps } from "@ksp-gonogo/core";
import { registerComponent, useTelemetry } from "@ksp-gonogo/core";
import type { Reading } from "@ksp-gonogo/sitrep-client";
import type { CommsDelay, CommsLink } from "@ksp-gonogo/sitrep-sdk";
import { useLatestValue, useUtNow } from "@ksp-gonogo/sitrep-sdk/spine";
import {
  Badge,
  Button,
  ComposerBar,
  ConsoleFrame,
  EmptyState,
  formatDuration,
  InFlightList,
  type InFlightListItem,
  Panel,
  ScrollArea,
  Section,
  Select,
  Text,
  VisuallyHidden,
} from "@ksp-gonogo/ui-kit";
import { useEffect, useState } from "react";
import styled from "styled-components";
import { StationNameEditor, useStationNameOptional } from "../stationIdentity";
import {
  CommcastProvider,
  useCommcastLog,
  useLocalParticipant,
  useMyVantage,
  useRecipients,
  useSeparationMatrix,
} from "./CommcastContext";
import type { CommcastLog } from "./CommcastLog";
import {
  firstAckUtFor,
  legOf,
  revealedAcks,
  roundTripFor,
  type SentPhase,
  type SeparationMatrix,
  sentPhaseFor,
  separationBetween,
  separationFor,
  type Vantage,
} from "./reveal";
import type { CommsRecipient, OutboundMessage, RecipientId } from "./types";
import { type CommcastEntry, useCommcastFeed } from "./useCommcastFeed";

/**
 * The value a VERDICT may be drawn from: current, or modelled forward to the
 * frame. A stale reading gives nothing, because the separation a message
 * freezes at send has to be the separation NOW.
 */
function judgeable<T>(reading: Reading<T>): T | undefined {
  if (reading.state === "observed") return reading.value;
  if (reading.state === "reckonable") return reading.reckoned.value;
  return undefined;
}

function CommcastComponent(_props: Readonly<ComponentProps>) {
  const log = useCommcastLog();
  const named = useStationNameOptional();
  const me = useMyVantage();
  const utNow = useUtNow();
  const pairs = useSeparationMatrix();
  const local = useLocalParticipant();
  const recipients = useRecipients(me);
  const [to, setTo] = useState<RecipientId | null>(null);
  const feed = useCommcastFeed(log, me, pairs);
  const dropped = useDroppedCount(log);
  /*
   * The craft-to-ground path home, and the FALLBACK separation only. Under the
   * broadcast model this was the whole answer, because no sender could know
   * its distance to every receiver. Addressing makes the published pair matrix
   * the primary source and leaves this standing in for the one pair
   * `comms.delay` actually measures, until the matrix covers it.
   */
  const pathHome =
    judgeable<CommsDelay>(useTelemetry("comms.delay"))?.oneWaySeconds
      ?.magnitude ?? null;
  /*
   * A CONFIRMED loss of line of sight, and only that. `undefined` is "no link
   * data yet" and reads as connected, the same rule the terminal widget applies
   * to the same topic: a screen that has heard nothing about the link must not
   * accuse the log of being incomplete, which is exactly what a screen whose
   * route has simply not published yet would do on every first frame.
   *
   * Read through `useLatestValue` rather than the certainty-gated hook the
   * messages themselves come through, for the reason the terminal widget reads
   * it the same way: `comms.link` is Delayed but freeze-EXEMPT, so its
   * disconnect edge already reveals at the light-time horizon. Putting it
   * through the gate a second time would hold the news of a lost link for
   * another whole light-time, which is the one reading that must not be late.
   */
  const noSignal = useLatestValue<CommsLink>("comms.link")?.connected === false;

  // Default to the first addressable centre so a screen that has only ever
  // seen one correspondent needs no choice made before it can speak.
  const target = to ?? recipients[0]?.id ?? null;
  /*
   * A vantage id is an ADDRESS, not a name: `vessel:8f2c-...` is what routes a
   * message and is not what anybody calls the craft. The roster carries the
   * display name, so the id only ever reaches the screen when the roster has
   * not named that vantage, which is itself worth seeing.
   */
  const nameFor = (id: RecipientId) =>
    recipients.find((r) => r.id === id)?.name ?? id;
  const separation = separationBetween(
    me.vantageId,
    target ?? undefined,
    pathHome,
    pairs,
  );
  const separationSeconds =
    separation.kind === "no-path"
      ? null
      : separation.kind === "light-time"
        ? separation.seconds
        : 0;

  if (!log) {
    /*
     * A reading, not an explanation. This state and the empty log below it are
     * the two the operator has to tell apart, and a sentence describing the
     * architecture would not help them tell.
     */
    return (
      <Panel
        panelTitle="Commcast"
        sections={<EmptyState layout="fill">No log yet</EmptyState>}
      />
    );
  }

  /*
   * Identity, in the header rather than in a body row. It is who this screen
   * is, which the operator needs once and not while reading, so it does not
   * need to cost the log a row of its height.
   */
  const identity = (
    <Commcast__Identity>
      {/* The editor needs an identity provider; a screen without one still
          posts under its seat's name, shown flat. */}
      {named === undefined ? (
        <Text size="xs">{local.name}</Text>
      ) : (
        <StationNameEditor compact />
      )}
      {/* The kit's `Badge`, not a local square. Carries no severity: a seat is
          an identity, and dressing "ABOARD" as `nominal` would put a green
          go-pill on a fact that is neither good nor bad and would contribute a
          meaningless rank to the panel's status summary. The pilot-versus-
          ground COLOUR survives where it is load-bearing, on the author names
          in the log. */}
      <Badge size="sm">
        {me.seat === "pilot" ? "Aboard" : "Mission control"}
      </Badge>
    </Commcast__Identity>
  );

  /*
   * Hoisted out of the `sections` attribute rather than written inline. The
   * Panel-body scan tracks brace depth through an attribute value and reads a
   * `'` as a string delimiter, so an odd number of apostrophes in JSX PROSE
   * desynchronises it and a self-closing Panel is reported as carrying a body.
   * A named value sidesteps that and reads better besides.
   */
  const body = (
    /*
     * `fill`, because the log is the tile. Without it the section keeps its
     * content height (`PanelSections__Grid` is `align-items: start` on
     * purpose) and the widget renders as a short box with a large empty
     * bottom, which is the one shape the terminal it is aligned with never
     * has: that one is `height: 100%` and always was.
     */
    <Section fill>
      <Commcast__Frame>
        <ConsoleFrame>
          <Commcast__Scroll>
            <Commcast__List>
              {/* At the HEAD, because the front of the log is where the drop
                happened. A log that forgets has to say it forgot, and saying so
                in a footnote under the composer put it as far from the gap as
                the widget allows. */}
              {dropped > 0 && (
                <ThreadMarker>
                  {dropped} earlier message{dropped === 1 ? "" : "s"} dropped at
                  the cap
                </ThreadMarker>
              )}
              {feed.log.length === 0 && feed.outbound.length === 0 && (
                <EmptyState>Nothing said yet.</EmptyState>
              )}
              {feed.log.map((entry) => (
                <MessageRow
                  key={entry.msg.id}
                  entry={entry}
                  me={me}
                  utNow={utNow}
                  pairs={pairs}
                  log={log}
                  separationSeconds={separationSeconds}
                  nameFor={nameFor}
                />
              ))}
              {/* At the TAIL, and a rule rather than a row: it terminates what
                this vantage knows was said. Everything above it arrived; past
                it there may be words nobody here has heard. That is a different
                claim from a message in transit, which is one specific utterance
                with an instant it lands at, and the two must not read alike. */}
              {noSignal && <ThreadMarker $blocked>no signal</ThreadMarker>}
            </Commcast__List>
          </Commcast__Scroll>
        </ConsoleFrame>

        {/* The terminal widget's uplink queue, in the terminal widget's place:
          pinned between the console and the composer, never inside the scroll,
          where it would take the bottom of the log as it grows. Same component
          and same two-leg vocabulary, because it is the same journey. */}
        <OutboundQueue
          outbound={feed.outbound}
          me={me}
          utNow={utNow}
          pairs={pairs}
        />

        <Composer
          log={log}
          me={me}
          local={local}
          utNow={utNow}
          recipients={recipients}
          target={target}
          onTarget={setTo}
          separation={separation}
          separationSeconds={separationSeconds}
        />
      </Commcast__Frame>
    </Section>
  );

  return <Panel panelTitle="Commcast" panelAside={identity} sections={body} />;
}

/** One message in this vantage's log: something heard, or something settled. */
function MessageRow({
  entry,
  me,
  utNow,
  pairs,
  log,
  separationSeconds,
  nameFor,
}: {
  entry: CommcastEntry;
  me: Vantage;
  utNow: number | undefined;
  pairs: SeparationMatrix | undefined;
  log: CommcastLog;
  separationSeconds: number | null;
  nameFor: (id: RecipientId) => string;
}) {
  const { msg, out } = entry;
  const sep = separationFor(msg, me, pairs);
  return (
    <Commcast__Message>
      <Commcast__Meta>
        <Author $pilot={msg.authorSeat === "pilot"}>{msg.authorName}</Author>
        {out ? (
          <SentVerdict
            out={out}
            me={me}
            utNow={utNow}
            pairs={pairs}
            nameFor={nameFor}
          />
        ) : (
          <>
            {sep.kind === "light-time" && sep.seconds > 0 && (
              <Text size="xs" tone="info">
                took {formatDuration(sep.seconds)}
              </Text>
            )}
            {sep.kind === "unmeasured" && (
              <Text size="xs" tone="warn">
                separation to that vantage is unpublished
              </Text>
            )}
          </>
        )}
      </Commcast__Meta>
      <Commcast__Body>{msg.body}</Commcast__Body>
      {out && (
        <UnconfirmedActions
          out={out}
          me={me}
          utNow={utNow}
          pairs={pairs}
          log={log}
          separationSeconds={separationSeconds}
        />
      )}
    </Commcast__Message>
  );
}

/**
 * What came back about something this screen said.
 *
 * `confirmed` carries the round trip that actually elapsed, which is the
 * terminal widget's latency stated after the fact rather than predicted
 * before it.
 * Everything else is UNCONFIRMED, and unconfirmed is a state the message is in
 * rather than an error about it: no warning tone, no dismissal, just the
 * reading. It says which of two different things happened, because they call
 * for different judgements: nothing came back, or nothing left.
 */
function SentVerdict({
  out,
  me,
  utNow,
  pairs,
  nameFor,
}: {
  out: OutboundMessage;
  me: Vantage;
  utNow: number | undefined;
  pairs: SeparationMatrix | undefined;
  nameFor: (id: RecipientId) => string;
}) {
  const now = utNow ?? Number.NEGATIVE_INFINITY;
  const phase = sentPhaseFor(out, me, now, pairs);
  const heard = revealedAcks(out, me, now, pairs).length;
  if (phase === "confirmed") {
    const ackUt = firstAckUtFor(out, me, pairs);
    const elapsed = ackUt === undefined ? null : ackUt - out.msg.lastSentUt;
    return (
      <>
        <Text size="xs" tone="faint">
          to {out.msg.to.map(nameFor).join(", ")}
        </Text>
        {elapsed !== null && elapsed > 0 && (
          <Text size="xs" tone="info">
            confirmed after {formatDuration(elapsed)}
          </Text>
        )}
        {heard > 1 && (
          <Text size="xs" tone="faint">
            heard by {heard}
          </Text>
        )}
      </>
    );
  }
  return (
    <>
      <Text size="xs" tone="faint">
        to {out.msg.to.map(nameFor).join(", ")}
      </Text>
      <Text size="xs" tone="faint">
        {out.neverLeft ? "unconfirmed, no path when sent" : "unconfirmed"}
      </Text>
      {out.msg.attempts > 1 && (
        <Text size="xs" tone="faint">
          sent {out.msg.attempts} times
        </Text>
      )}
    </>
  );
}

/**
 * The single action an unconfirmed message carries: send it again.
 *
 * ONE action rather than a resend and a separate re-ask, because the two cost
 * the same two legs and answer the same question. The recipient dedupes on the
 * message id, so a resend either finds a copy already there and acknowledges
 * it, which answers "did it arrive", or delivers one that was missing. A bare
 * ack query would buy nothing a text body does not already cost. (A recorded
 * body would change that arithmetic; text does not.)
 */
function UnconfirmedActions({
  out,
  me,
  utNow,
  pairs,
  log,
  separationSeconds,
}: {
  out: OutboundMessage;
  me: Vantage;
  utNow: number | undefined;
  pairs: SeparationMatrix | undefined;
  log: CommcastLog;
  separationSeconds: number | null;
}) {
  const phase = sentPhaseFor(out, me, utNow ?? Number.NEGATIVE_INFINITY, pairs);
  if (phase === "confirmed") return null;
  const ready = utNow !== undefined && separationSeconds !== null;
  return (
    <Commcast__Actions>
      <Button
        disabled={!ready}
        onClick={() => {
          if (utNow === undefined) return;
          log.resend(out.msg.id, utNow, separationSeconds);
        }}
      >
        {separationSeconds === null ? "No path to resend" : "Send again"}
      </Button>
    </Commcast__Actions>
  );
}

/**
 * This screen's own words, still out.
 *
 * The kit's `InFlightList`, and the two-leg journey it draws is now literally
 * this one: `outbound` is the message crossing to its recipient, `return` is
 * the acknowledgement coming back, the same pair `FleetComms/pendingPulse.ts`
 * names for a delayed command's pulse. The commcast2 pass rejected this
 * component because "a spoken message has one leg and no reply", which was
 * true of a broadcast and is not true of an addressed message.
 *
 * Three of the five phases are reachable here: `in-transit`, `awaiting-reply`
 * and `due`. `overdue` and `lost` are the EXIT conditions rather than rows,
 * because a message that stops waiting does not vanish the way a command's
 * queue entry does: it moves into the log as unconfirmed, with one resend. A
 * row in the queue and a row in the log at once would be the duplicate the
 * whole design avoids.
 */
function OutboundQueue({
  outbound,
  me,
  utNow,
  pairs,
}: {
  outbound: readonly OutboundMessage[];
  me: Vantage;
  utNow: number | undefined;
  pairs: SeparationMatrix | undefined;
}) {
  const items: InFlightListItem[] = outbound.map((out) => {
    const phase =
      utNow === undefined ? "in-transit" : sentPhaseFor(out, me, utNow, pairs);
    return {
      id: out.msg.id,
      // The words themselves, the way the terminal widget's line-mode dispatch labels itself
      // with the line that was typed. There is nothing else a message could be
      // called, and the author is the only person who sees this row.
      label: out.msg.body ?? out.msg.kind,
      etaSeconds: etaFor(out, phase, utNow),
      phase: phase === "confirmed" ? "due" : phase,
      ...(utNow === undefined ? {} : { progress: progressFor(out, utNow) }),
    };
  });
  return <InFlightList items={items} ariaLabel="Uplink queue" />;
}

/**
 * Which clock a queue row shows, phase-driven the same way
 * `toInFlightListItems` does it: while the message is still crossing the
 * visible event is it REACHING its recipient, so it counts to the reach
 * instant; once it has arrived the meaningful wait is the acknowledgement, so
 * it counts to the reply.
 */
function etaFor(
  out: OutboundMessage,
  phase: SentPhase,
  utNow: number | undefined,
): number | null {
  const trip = roundTripFor(out.msg);
  if (trip === null || utNow === undefined) return null;
  if (legOf(phase) === "outbound") return trip.reachUt - utNow;
  if (legOf(phase) === "return") return Math.max(0, trip.replyUt - utNow);
  return null;
}

/** Position on the round trip, 0 at send to 1 at the reply instant. */
function progressFor(out: OutboundMessage, utNow: number): number {
  const trip = roundTripFor(out.msg);
  if (trip === null) return 0;
  const span = trip.replyUt - out.msg.lastSentUt;
  if (span <= 0) return 1;
  return Math.max(0, Math.min(1, (utNow - out.msg.lastSentUt) / span));
}

function Composer({
  log,
  me,
  local,
  utNow,
  recipients,
  target,
  onTarget,
  separation,
  separationSeconds,
}: {
  log: CommcastLog;
  me: Vantage;
  local: ReturnType<typeof useLocalParticipant>;
  utNow: number | undefined;
  recipients: readonly CommsRecipient[];
  target: RecipientId | null;
  onTarget: (id: RecipientId) => void;
  separation: ReturnType<typeof separationBetween>;
  separationSeconds: number | null;
}) {
  const [draft, setDraft] = useState("");
  const ready =
    draft.trim().length > 0 &&
    utNow !== undefined &&
    target !== null &&
    me.vantageId !== undefined;
  const submit = () => {
    if (!ready || utNow === undefined || target === null) return;
    if (me.vantageId === undefined) return;
    log.send(
      {
        stationKey: local.stationKey,
        name: local.name,
        seat: local.seat,
        vantageId: me.vantageId,
      },
      {
        kind: "text",
        body: draft.trim(),
        // A LIST, and it holds one entry in this pass. Groups are then an
        // additive change to the reveal and the UI rather than a wire change.
        to: [target],
        // The sender's own present. NOT `confirmedEdgeUt()`, which is already
        // a light-time behind and would push every arrival out to a round trip.
        sentUt: utNow,
        // Frozen here and never re-read: a changing separation must not
        // un-deliver something already promised.
        separationSeconds,
      },
    );
    setDraft("");
  };
  const noPath = separation.kind === "no-path";
  const roundTrip = separationSeconds === null ? null : separationSeconds * 2;
  return (
    /* The bar's own outline says whether this is going anywhere, the same way
       the terminal widget's does: with no path to the chosen recipient it
       turns error-toned while the operator is still typing, rather than
       reporting the refusal only after they have pressed send. The flag says
       why an outline has turned red, which an outline cannot. */
    <ComposerBar blocked={noPath} {...(noPath ? { flag: "NO PATH" } : {})}>
      <label htmlFor="commcast-to">
        <VisuallyHidden>Send to</VisuallyHidden>
      </label>
      <Commcast__To
        id="commcast-to"
        value={target ?? ""}
        onChange={(e) => onTarget(e.target.value)}
        disabled={recipients.length === 0}
      >
        {recipients.length === 0 && <option value="">No correspondents</option>}
        {recipients.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
      </Commcast__To>
      <label htmlFor="commcast-draft">
        <VisuallyHidden>Message</VisuallyHidden>
      </label>
      {/*
        A plain free-text line TODAY, and left addressable so it need not be
        unpicked: the submit path reads the draft once, at `submit`, rather
        than parsing as the operator types, so a leading-token mode could be
        introduced ahead of it without touching anything else. The terminal
        widget this is aligned with already has a `/`-script picker on its own
        composer, which is where a structured-request affordance would go if
        Commcast ever grows one. Nothing here builds toward it.
      */}
      <Commcast__Input
        id="commcast-draft"
        value={draft}
        placeholder={utNow === undefined ? "No clock yet" : "Message"}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
      />
      {/* The ROUND TRIP, which is what pressing this actually costs the
          operator: their own words do not come back until the recipient is
          shown to have heard them. The same number the terminal widget prints in
          its corner, and it is here rather than in a corner because this is
          where the decision is made. */}
      <Button disabled={!ready} onClick={submit}>
        {noPath
          ? "Send (no path)"
          : roundTrip !== null && roundTrip > 0
            ? `Send (round trip ${formatDuration(roundTrip)})`
            : "Send"}
      </Button>
    </ComposerBar>
  );
}

/** How many messages this log has dropped at the cap, reactively. */
function useDroppedCount(log: CommcastLog | null): number {
  const [dropped, setDropped] = useState(
    () => log?.snapshot().droppedCount ?? 0,
  );
  useEffect(() => {
    if (!log) return;
    setDropped(log.snapshot().droppedCount);
    return log.subscribe((snap) => setDropped(snap.droppedCount));
  }, [log]);
  return dropped;
}

/**
 * The widget mounts its own provider so it works wherever it is placed,
 * including a screen that never wired one. On the host the provider finds the
 * log through context; on a peer it builds one over the peer link.
 */
function CommcastWidget(props: Readonly<ComponentProps>) {
  return (
    <CommcastProvider>
      <CommcastComponent {...props} />
    </CommcastProvider>
  );
}

const Commcast__Frame = styled.div`
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1 1 auto;
  gap: var(--space-6);
`;

const Commcast__Identity = styled.div`
  display: flex;
  align-items: center;
  gap: var(--space-6);
`;

/*
 * The log's own inset, and its anchor. `ConsoleFrame` draws to its border with
 * no gutter, which is right for a terminal emulator and wrong for text, so the
 * padding goes on the scrolling children rather than on the frame.
 *
 * The inner is made a flex column so `Commcast__List` can take a `margin-top:
 * auto` and sit against the BOTTOM of the frame, next to the composer, growing
 * upward as the log fills. A short log otherwise starts at the top with the
 * empty space between the newest line and the box it is typed into, which is
 * the opposite of how the terminal this is aligned with reads. The auto margin
 * resolves to zero once the log is taller than the frame, so a full one
 * scrolls exactly as before.
 */
const Commcast__Scroll = styled(ScrollArea)`
  & [data-scroll-area-inner] {
    display: flex;
    flex-direction: column;
    padding: var(--space-8);
  }
`;

const Commcast__List = styled.div`
  display: flex;
  flex-direction: column;
  /* See the scroll wrapper above: pins a short log to the frame's bottom. */
  margin-top: auto;
  gap: var(--space-6);
`;

/*
 * A boundary in the log, not a row in it. A message is an author, a stamp and
 * words; this is a rule across the column with a word on it, so the two can
 * never be misread for one another. Two uses, at the two ends: what the log has
 * forgotten off the front, and where what this vantage knows stops.
 */
const ThreadMarker = styled.div<{ $blocked?: boolean }>`
  display: flex;
  align-items: center;
  gap: var(--space-6);
  font-size: var(--font-size-2xs);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: ${({ $blocked }) =>
    $blocked ? "var(--color-status-nogo-fg)" : "var(--color-text-faint)"};

  &::before,
  &::after {
    content: "";
    flex: 1 1 auto;
    border-top: 1px solid
      ${({ $blocked }) =>
        $blocked
          ? "var(--color-status-nogo-fg)"
          : "var(--color-border-subtle)"};
  }
`;

const Commcast__Message = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--space-hair);
`;

const Commcast__Meta = styled.div`
  display: flex;
  align-items: baseline;
  gap: var(--space-6);
  flex-wrap: wrap;
`;

const Author = styled.span<{ $pilot: boolean }>`
  font-size: var(--font-size-xs);
  font-weight: 600;
  color: ${({ $pilot }) =>
    $pilot ? "var(--color-status-go-fg)" : "var(--color-status-info-fg)"};
`;

const Commcast__Body = styled.p`
  margin: 0;
  font-size: var(--font-size-sm);
  color: var(--color-text-primary);
  overflow-wrap: anywhere;
`;

const Commcast__Actions = styled.div`
  display: flex;
  align-items: center;
  gap: var(--space-6);
  flex-wrap: wrap;
`;

const Commcast__To = styled(Select)`
  flex: 0 1 auto;
  min-width: 0;
  max-width: 40%;
`;

const Commcast__Input = styled.input`
  flex: 1 1 auto;
  min-width: 0;
  font: inherit;
  font-size: var(--font-size-sm);
  color: var(--color-text-primary);
  background: var(--color-surface-sunken);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-sm);
  padding: var(--space-4) var(--space-6);

  &:focus-visible {
    outline: 2px solid var(--color-status-go-fg);
    outline-offset: 2px;
  }
`;

registerComponent({
  id: "commcast",
  name: "Commcast",
  description:
    "Addressed messages between the command centres and craft on this mission. A message crosses the light-time to the vantage it names, is acknowledged back, and your own words appear only once that acknowledgement returns, so the wait you feel is the wait that is really there.",
  tags: ["mission-control", "comms"],
  defaultSize: { w: 6, h: 8 },
  minSize: { w: 4, h: 5 },
  component: CommcastWidget,
  /*
   * `commandCentre.roster` is who can be addressed; `commandCentre.separation`
   * is how far away each of them is. `comms.delay` is the craft-to-ground
   * fallback for a pair the matrix has not reached. `comms.link` is what
   * terminates the log: a confirmed loss of line of sight means there may be
   * words this vantage has not heard, which is a different claim from a
   * message in transit.
   */
  channels: [
    "commandCentre.roster",
    "commandCentre.separation",
    "comms.delay",
    "comms.link",
  ],
  // Aboard AND on the ground: the whole point is that both ends are in it.
  seats: ["mission-control", "pilot"],
  defaultConfig: {},
  actions: [],
  pushable: false,
});

export { CommcastWidget };
