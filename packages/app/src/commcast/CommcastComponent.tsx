import type { ComponentProps } from "@ksp-gonogo/core";
import { registerComponent, useTelemetry } from "@ksp-gonogo/core";
import type { Reading } from "@ksp-gonogo/sitrep-client";
import type { CommsDelay, CommsLink } from "@ksp-gonogo/sitrep-sdk";
import { signalDelayPresentation, value } from "@ksp-gonogo/sitrep-sdk";
import { useLatestValue, useUtNow } from "@ksp-gonogo/sitrep-sdk/spine";
import {
  ArrowLeftIcon,
  Badge,
  Button,
  ComposerBar,
  ConsoleFrame,
  EmptyState,
  GhostButton,
  InFlightList,
  type InFlightListItem,
  MissionDate,
  Panel,
  PlusIcon,
  ScrollArea,
  Section,
  SelectableRow,
  SignalDelayBadge,
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
  revealUtFor,
  roundTripFor,
  type SentPhase,
  type SeparationMatrix,
  sentPhaseFor,
  separationBetween,
  separationFor,
  type Vantage,
} from "./reveal";
import { type CommcastThread, threadFor, threadsOf } from "./threads";
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

/**
 * Which of the widget's three screens the operator is on.
 *
 * An INBOX and the conversations inside it, rather than one transcript with a
 * recipient picker over it. The picker implied a single log filtered by
 * selection, which is not what addressing made true: each correspondence is
 * genuinely separate and only its own two ends hold it. Two views also take
 * the recipient control out of the reading surface entirely, which is where it
 * was costing the log a row of its height.
 */
type CommcastView =
  | { kind: "inbox" }
  /** Choosing who to start a conversation with. */
  | { kind: "compose" }
  /** Inside one conversation, with the ends it is with. */
  | { kind: "thread"; with: readonly RecipientId[] };

function CommcastComponent(_props: Readonly<ComponentProps>) {
  const log = useCommcastLog();
  const named = useStationNameOptional();
  const me = useMyVantage();
  const utNow = useUtNow();
  const pairs = useSeparationMatrix();
  const local = useLocalParticipant();
  const recipients = useRecipients(me);
  const [view, setView] = useState<CommcastView>({ kind: "inbox" });
  const feed = useCommcastFeed(log, me, pairs);
  const dropped = useDroppedCount(log);
  const threads = threadsOf(feed, me);
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

  /*
   * A vantage id is an ADDRESS, not a name: `vessel:8f2c-...` is what routes a
   * message and is not what anybody calls the craft. The roster carries the
   * display name, so the id only ever reaches the screen when the roster has
   * not named that vantage, which is itself worth seeing.
   */
  const nameFor = (id: RecipientId) =>
    recipients.find((r) => r.id === id)?.name ?? id;
  /*
   * The one end a message actually goes to. Group DELIVERY is not built, so
   * this pass sends to a single recipient and the picker says so when a second
   * name is chosen; everything either side of it, the envelope's `to`, the
   * thread key and the reveal, already carries a list.
   */
  const target = view.kind === "thread" ? (view.with[0] ?? null) : null;
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
      {/*
        One frame, three views, and the same geometry in all three: a header
        row, the console taking the rest, and a bar at the foot. Switching view
        must not resize the tile, which is the operator's "the UI should look
        the same just with no recipient selection and a back button".
      */}
      <Commcast__Frame>
        {view.kind === "inbox" && (
          <InboxView
            threads={threads}
            dropped={dropped}
            nameFor={nameFor}
            canCompose={recipients.length > 0}
            onOpen={(ids) => setView({ kind: "thread", with: ids })}
            onCompose={() => setView({ kind: "compose" })}
          />
        )}
        {view.kind === "compose" && (
          <ComposeView
            recipients={recipients}
            onBack={() => setView({ kind: "inbox" })}
            onOpen={(ids) => setView({ kind: "thread", with: ids })}
          />
        )}
        {view.kind === "thread" && (
          <ThreadView
            thread={threadFor(threads, view.with)}
            me={me}
            utNow={utNow}
            pairs={pairs}
            log={log}
            noSignal={noSignal}
            nameFor={nameFor}
            local={local}
            separation={separation}
            separationSeconds={separationSeconds}
            target={target}
            onBack={() => setView({ kind: "inbox" })}
          />
        )}
      </Commcast__Frame>
    </Section>
  );

  return <Panel panelTitle="Commcast" panelAside={identity} sections={body} />;
}

/**
 * The correspondences this vantage holds, and the way into a new one.
 *
 * This is the log-level view, so it is where a log that FORGOT says so: the
 * drop happened off the front of everything this screen holds rather than
 * inside one conversation, and repeating the notice in every thread would
 * claim each of them lost something.
 */
function InboxView({
  threads,
  dropped,
  nameFor,
  canCompose,
  onOpen,
  onCompose,
}: {
  threads: readonly CommcastThread[];
  dropped: number;
  nameFor: (id: RecipientId) => string;
  canCompose: boolean;
  onOpen: (ids: readonly RecipientId[]) => void;
  onCompose: () => void;
}) {
  return (
    <>
      <Commcast__Bar>
        {threads.length > 0 && (
          <Text size="xs" tone="muted">
            {threads.length} conversation{threads.length === 1 ? "" : "s"}
          </Text>
        )}
        <Commcast__BarGap />
        <Button type="button" onClick={onCompose} disabled={!canCompose}>
          <PlusIcon size={14} />
          New message
        </Button>
      </Commcast__Bar>
      {/* No footer: the inbox is a list of conversations, and there is nothing
          to type at it. The frame is the same one the other two views use, in
          the same tone, so the tile does not change shape on the way in. */}
      <ConsoleFrame tone={COMMCAST_TONE}>
        <Commcast__Scroll>
          <Commcast__Rows>
            {dropped > 0 && (
              <ThreadMarker>
                {dropped} earlier message{dropped === 1 ? "" : "s"} dropped at
                the cap
              </ThreadMarker>
            )}
            {threads.length === 0 && (
              <EmptyState>
                {canCompose
                  ? "No conversations yet."
                  : "No conversations, and no correspondents."}
              </EmptyState>
            )}
            {threads.map((thread) => (
              <SelectableRow
                key={thread.key}
                selected={false}
                onClick={() => onOpen(thread.with)}
              >
                <Commcast__RowHead>
                  <Commcast__RowName>
                    {thread.with.map(nameFor).join(", ")}
                  </Commcast__RowName>
                  {/* The one state an inbox row needs: something is still
                      crossing in there. Everything else about a message is a
                      fact about that message, and belongs on its own row
                      inside the conversation. */}
                  {thread.outbound.length > 0 && (
                    <Text size="xs" tone="info">
                      {thread.outbound.length} out
                    </Text>
                  )}
                </Commcast__RowHead>
                <Commcast__Preview>{thread.preview}</Commcast__Preview>
              </SelectableRow>
            ))}
          </Commcast__Rows>
        </Commcast__Scroll>
      </ConsoleFrame>
    </>
  );
}

/**
 * Choosing who a new conversation is with.
 *
 * A LIST of recipients, and the rows toggle rather than select-one, because
 * the envelope has always carried a list and a picker that could never hold a
 * second name would have to be rebuilt to grow one. What is not built is group
 * DELIVERY: the author's frozen separation is a single figure and the
 * acknowledgement window is measured off it, so a second name is refused HERE,
 * where the operator can see why, rather than sent and silently mis-timed.
 */
function ComposeView({
  recipients,
  onBack,
  onOpen,
}: {
  recipients: readonly CommsRecipient[];
  onBack: () => void;
  onOpen: (ids: readonly RecipientId[]) => void;
}) {
  const [picked, setPicked] = useState<readonly RecipientId[]>([]);
  const toggle = (id: RecipientId) =>
    setPicked((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id],
    );
  const group = picked.length > 1;
  return (
    <>
      <Commcast__Bar>
        <BackButton onClick={onBack} />
        <Text size="sm" tone="default">
          New message
        </Text>
      </Commcast__Bar>
      <ConsoleFrame
        tone={COMMCAST_TONE}
        blocked={group}
        footer={
          /* The bar's own commit slot, and its own verb: a picker opens rather
             than sends, but it is the same control in the same place, so it
             needs neither a second button nor the spacer that used to push one
             there. No prompt glyph: this composer chooses rather than types. */
          <ComposerBar
            blocked={group}
            {...(group ? { flag: "ONE AT A TIME" } : {})}
            onSend={() => onOpen(picked)}
            sendDisabled={picked.length !== 1}
            sendLabel="Open"
          >
            <Text size="xs" tone={group ? "nogo" : "faint"}>
              {group
                ? "Group delivery is not carried yet"
                : picked.length === 1
                  ? "Ready"
                  : "Choose a recipient"}
            </Text>
          </ComposerBar>
        }
      >
        <Commcast__Scroll>
          <Commcast__Rows>
            {recipients.length === 0 && (
              <EmptyState>No correspondents</EmptyState>
            )}
            {recipients.map((r) => (
              <SelectableRow
                key={r.id}
                selected={picked.includes(r.id)}
                onClick={() => toggle(r.id)}
              >
                <Commcast__RowHead>
                  <Commcast__RowName>{r.name}</Commcast__RowName>
                  {/* A roster entry nobody is sitting at is still addressable,
                      and the message will go unacknowledged, which is an
                      honest outcome rather than a reason to hide it. Saying so
                      before it is sent is what stops that reading as a fault. */}
                  {!r.staffed && (
                    <Text size="xs" tone="faint">
                      unstaffed
                    </Text>
                  )}
                </Commcast__RowHead>
              </SelectableRow>
            ))}
          </Commcast__Rows>
        </Commcast__Scroll>
      </ConsoleFrame>
    </>
  );
}

/**
 * One conversation: what today's widget was, minus the recipient control and
 * plus a way back.
 *
 * The back row carries the correspondent's name, and it is in the BODY rather
 * than the panel aside: an aside collapses at narrow widths and would take the
 * only way out of a thread with it.
 */
function ThreadView({
  thread,
  me,
  utNow,
  pairs,
  log,
  noSignal,
  nameFor,
  local,
  separation,
  separationSeconds,
  target,
  onBack,
}: {
  thread: CommcastThread;
  me: Vantage;
  utNow: number | undefined;
  pairs: SeparationMatrix | undefined;
  log: CommcastLog;
  noSignal: boolean;
  nameFor: (id: RecipientId) => string;
  local: ReturnType<typeof useLocalParticipant>;
  separation: ReturnType<typeof separationBetween>;
  separationSeconds: number | null;
  target: RecipientId | null;
  onBack: () => void;
}) {
  /*
   * The terminal widget's delay model, from the kit both widgets now share: a
   * standing BADGE when the other end is close enough that a countdown would be
   * over before it could be read, the in-transit STRIP when it is far enough
   * that a countdown is the reading, and never both. Before this the chip and
   * the strip were drawn together, saying the same separation twice in two
   * shapes, and the operator had to work out which one was about the message
   * they had just sent.
   */
  const delayPresentation = signalDelayPresentation({
    oneWaySeconds:
      separationSeconds === null ? null : value("s", separationSeconds),
    canQueue: true,
  });
  const noPath = separation.kind === "no-path";
  return (
    <>
      <Commcast__Bar>
        <BackButton onClick={onBack} />
        <Text size="sm" tone="default">
          {thread.with.map(nameFor).join(", ")}
        </Text>
      </Commcast__Bar>
      {/* One box: the log, the outbound queue and the line being typed all
          inside the same border, in the same order the terminal widget puts
          them. They were three stacked boxes and the border contained only the
          first, which is why the two consoles did not read as one component. */}
      <ConsoleFrame
        tone={COMMCAST_TONE}
        blocked={noPath}
        footer={
          <>
            {/* The terminal widget's uplink queue, in the terminal widget's
                place: between the log and the composer, never inside the
                scroll, where it would take the bottom of the log as it grows.
                Same component and same two-leg vocabulary, because it is the
                same journey. */}
            {/* Gated on NOT-badge rather than on `=== "strip"`, which is where
                this departs from the terminal widget by one case and has to.

                A message freezes its separation at send and keeps crossing on
                it, so the queue outlives the live reading the badge is drawn
                from: words put out at four light-minutes are still four
                light-minutes out after the path drops, and this strip is the
                ONLY place they appear (the log holds nothing until something
                comes back). The terminal's route items are derived from the
                live route instead, so it has nothing to lose by reading
                `=== "strip"`.

                What the operator asked for survives either way: the badge and
                the strip are still never drawn together. */}
            {delayPresentation !== "badge" && (
              <OutboundQueue
                outbound={thread.outbound}
                me={me}
                utNow={utNow}
                pairs={pairs}
              />
            )}
            <Composer
              log={log}
              me={me}
              local={local}
              utNow={utNow}
              target={target}
              noPath={noPath}
              separationSeconds={separationSeconds}
              badgeSeconds={
                delayPresentation === "badge" ? separationSeconds : null
              }
            />
          </>
        }
      >
        <Commcast__Scroll>
          <Commcast__List>
            {thread.entries.length === 0 && thread.outbound.length === 0 && (
              <EmptyState>Nothing said yet.</EmptyState>
            )}
            {thread.entries.map((entry) => (
              <MessageRow
                key={entry.msg.id}
                entry={entry}
                me={me}
                utNow={utNow}
                pairs={pairs}
                log={log}
                separationSeconds={separationSeconds}
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
    </>
  );
}

/** Out of a conversation and back to the list of them. */
function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <Commcast__Back type="button" onClick={onClick}>
      <ArrowLeftIcon size={14} />
      Inbox
    </Commcast__Back>
  );
}

/** One message in this vantage's log: something heard, or something settled. */
function MessageRow({
  entry,
  me,
  utNow,
  pairs,
  log,
  separationSeconds,
}: {
  entry: CommcastEntry;
  me: Vantage;
  utNow: number | undefined;
  pairs: SeparationMatrix | undefined;
  log: CommcastLog;
  separationSeconds: number | null;
}) {
  const { msg, out } = entry;
  return (
    <Commcast__Message>
      <Commcast__Meta>
        <Author $pilot={msg.authorSeat === "pilot"}>{msg.authorName}</Author>
        {out ? (
          <SentVerdict out={out} me={me} utNow={utNow} pairs={pairs} />
        ) : (
          <HeardVerdict msg={msg} me={me} pairs={pairs} />
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
 * When something arrived HERE.
 *
 * Every stamp in the log is an instant at this vantage, sent and received
 * alike, which is what makes them comparable down a column: the row is in the
 * log because it landed, and this is when. A crossing DURATION would be a
 * second quantity in the same slot, and the crossing is already drawn while it
 * is happening, on the queue strip above the composer.
 */
function HeardVerdict({
  msg,
  me,
  pairs,
}: {
  msg: CommcastEntry["msg"];
  me: Vantage;
  pairs: SeparationMatrix | undefined;
}) {
  const at = revealUtFor(msg, me, pairs);
  const sep = separationFor(msg, me, pairs);
  return (
    <>
      {at !== null && (
        <Text size="xs" tone="faint">
          <MissionDate value={at} />
        </Text>
      )}
      {sep.kind === "unmeasured" && (
        <Text size="xs" tone="warn">
          separation unpublished
        </Text>
      )}
    </>
  );
}

/**
 * What came back about something this screen said, in one reading.
 *
 * Acknowledged gets the INSTANT the confirmation landed here, which is both the
 * message's place in the log and the evidence it arrived. Everything else is
 * UNCONFIRMED, and unconfirmed is a state the message is in rather than an
 * error about it: no warning tone, no dismissal. It still says which of two
 * different things happened, because they call for different judgements:
 * nothing came back, or nothing left.
 *
 * The recipient is deliberately absent. A thread is a conversation with named
 * ends, so "to Ares 4" on every row of it repeated the header once per
 * message, which is what a per-row sentence costs when the addressing moved
 * into the view.
 */
function SentVerdict({
  out,
  me,
  utNow,
  pairs,
}: {
  out: OutboundMessage;
  me: Vantage;
  utNow: number | undefined;
  pairs: SeparationMatrix | undefined;
}) {
  const now = utNow ?? Number.NEGATIVE_INFINITY;
  const phase = sentPhaseFor(out, me, now, pairs);
  if (phase === "confirmed") {
    const heard = revealedAcks(out, me, now, pairs).length;
    const ackUt = firstAckUtFor(out, me, pairs);
    return (
      <>
        {ackUt !== undefined && (
          <Text size="xs" tone="faint">
            <MissionDate value={ackUt} />
          </Text>
        )}
        {/* Two stations at one centre both hold a message addressed to that
            vantage and both answer it, so a second confirmation is reachable
            without group delivery. */}
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
        {out.neverLeft ? "never left, no path" : "unconfirmed"}
      </Text>
      {out.msg.attempts > 1 && (
        <Text size="xs" tone="faint">
          attempt {out.msg.attempts}
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
        type="button"
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
  target,
  noPath,
  separationSeconds,
  badgeSeconds,
}: {
  log: CommcastLog;
  me: Vantage;
  local: ReturnType<typeof useLocalParticipant>;
  utNow: number | undefined;
  target: RecipientId | null;
  /**
   * No path to the chosen recipient, so nothing typed here is going anywhere.
   * Decided by the thread view rather than here, because the frame around this
   * bar takes the same tone from the same boolean and two components reading
   * the separation separately is two chances to disagree about it.
   */
  noPath: boolean;
  separationSeconds: number | null;
  /**
   * The one-way separation to show beside the control, or `null` when this is
   * not the view's delay reading. The CHOICE is the thread view's (it also owns
   * the strip, the other half of the same either-or); this component only draws
   * what it is handed.
   */
  badgeSeconds: number | null;
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
  return (
    /* The console says whether this is going anywhere, the same way the
       terminal widget's does: with no path to the chosen recipient the border
       turns error-toned while the operator is still typing, rather than
       reporting the refusal only after they have pressed send. The flag says
       why it has turned red, which a border cannot.

       The flag now says ONLY that. It used to carry the round trip too, which
       made one pinned slot answer two unrelated questions and put a figure
       there that the strip above was already drawing. The delay reading moved
       into the bar itself, as the terminal widget's badge, and the flag went
       back to being about refusal. The two never contend: no path means no
       separation to quote. */
    <ComposerBar
      blocked={noPath}
      prompt="❯"
      {...(noPath ? { flag: "NO PATH" } : {})}
      onSend={submit}
      sendDisabled={!ready}
    >
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
      {/* Between the input and the send button, so the reading sits on the path
          the eye takes to the control whose cost it is. It only ever shows a
          delay under a second (past that the strip above is the reading), so
          the string is short by construction and the composer cannot reflow on
          it, which is what the pinned chip was protecting against. */}
      {badgeSeconds !== null && (
        <SignalDelayBadge oneWaySeconds={badgeSeconds} />
      )}
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

/**
 * This console's accent, and the only visual difference between it and the
 * terminal widget it shares its parts with.
 *
 * The terminal keeps the primary accent because it dispatches to a craft;
 * carrying WORDS is informational, so this one takes the info tone. Named once
 * rather than repeated at each of the three views, which is what stops the
 * inbox and the thread drifting to different colours.
 */
const COMMCAST_TONE = "info" as const;

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
 * The row above the console, in all three views: the way out of where you are,
 * and what you are looking at. Non-growing, so it costs the console the same
 * fixed height whichever view is up.
 */
const Commcast__Bar = styled.div`
  display: flex;
  align-items: center;
  gap: var(--space-6);
  flex: 0 0 auto;
  min-width: 0;
`;

/** Pushes what follows to the far end of a bar. */
const Commcast__BarGap = styled.div`
  flex: 1 1 auto;
`;

const Commcast__Back = styled(GhostButton)`
  display: inline-flex;
  align-items: center;
  gap: var(--space-4);
  flex: 0 0 auto;
  font-size: var(--font-size-xs);
  padding: var(--space-2) var(--space-6);
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
 * A LIST of choices, unlike the log above it, so it starts at the top and grows
 * down: a conversation reads from its newest line at the bottom, and a list of
 * things to pick reads from its first row.
 */
const Commcast__Rows = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
`;

/*
 * Unstyled but for its size, so `SelectableRow`'s own colour reaches it: the
 * row go-tones its text when selected, and a name carrying its own tone would
 * sit at the accent colour in both states and say nothing about which.
 */
const Commcast__RowName = styled.span`
  font-size: var(--font-size-sm);
  color: inherit;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const Commcast__RowHead = styled.div`
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-6);
  width: 100%;
  min-width: 0;
`;

/* One line of the last thing said, clipped rather than wrapped: an inbox row
   is a pointer into a conversation, and a row that grows with the message it
   previews stops being scannable. */
const Commcast__Preview = styled.span`
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
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

/*
 * The line itself, and NOT a box. `ComposerBar` is already the bordered band
 * inside `ConsoleFrame`'s border, so an input carrying its own outline made the
 * one thing on the screen you type into the third box in a stack of three. The
 * terminal widget's composed line has always sat flush on its bar; this is that
 * line, drawn by a real `<input>` because these words are typed rather than
 * relayed from an emulator.
 *
 * The focus ring survives the border going: it is the only thing that says
 * which of the console's controls has the keyboard, and it takes the console's
 * own tone so it is the same ring in both widgets.
 */
const Commcast__Input = styled.input`
  flex: 1 1 auto;
  min-width: 0;
  font: inherit;
  font-size: var(--font-size-sm);
  color: var(--color-text-primary);
  background: transparent;
  border: none;
  padding: var(--space-2) 0;

  &:focus-visible {
    outline: 2px solid var(--console-tone-fg, var(--color-accent-fg));
    outline-offset: 2px;
  }
`;

registerComponent({
  id: "commcast",
  name: "Commcast",
  description:
    "Addressed messages between the command centres and craft on this mission. An inbox of conversations, each one crossing the light-time to the vantage it names and acknowledged back, so your own words appear only once that acknowledgement returns and the wait you feel is the wait that is really there.",
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
