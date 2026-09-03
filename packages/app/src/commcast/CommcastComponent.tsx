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
  Panel,
  ScrollArea,
  Section,
  Text,
  VisuallyHidden,
} from "@ksp-gonogo/ui-kit";
import { useEffect, useMemo, useRef, useState } from "react";
import styled from "styled-components";
import { StationNameEditor, useStationNameOptional } from "../stationIdentity";
import {
  CommcastProvider,
  type CommcastThread,
  useCommcastThread,
  useMyVantage,
  useSeparationMatrix,
} from "./CommcastContext";
import {
  deliveryFor,
  type SeparationMatrix,
  separationFor,
  type Vantage,
} from "./reveal";
import type { CommsMessage } from "./types";
import { useCommcastFeed } from "./useCommcastFeed";

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
  const thread = useCommcastThread();
  const named = useStationNameOptional();
  const me = useMyVantage();
  const utNow = useUtNow();
  const pairs = useSeparationMatrix();
  const feed = useCommcastFeed(thread, me, pairs);
  const dropped = useDroppedCount(thread);
  const oneWaySeconds =
    judgeable<CommsDelay>(useTelemetry("comms.delay"))?.oneWaySeconds
      ?.magnitude ?? null;
  /*
   * A CONFIRMED loss of line of sight, and only that. `undefined` is "no link
   * data yet" and reads as connected, the same rule the terminal widget applies
   * to the same topic: a screen that has heard nothing about the link must not
   * accuse the thread of being incomplete, which is exactly what a thread
   * whose route has simply not published yet would do on every first frame.
   *
   * Read through `useLatestValue` rather than the certainty-gated hook the
   * messages themselves come through, for the reason the terminal widget reads it
   * the same way: `comms.link` is Delayed but freeze-EXEMPT, so its disconnect
   * edge already reveals at the light-time horizon. Putting it through the
   * gate a second time would hold the news of a lost link for another whole
   * light-time, which is the one reading that must not be late.
   */
  const noSignal = useLatestValue<CommsLink>("comms.link")?.connected === false;

  if (!thread) {
    /*
     * A reading, not an explanation. This state and the empty thread below it
     * are the two the operator has to tell apart, and the sentence that used
     * to be here described the architecture (which screen owns the thread)
     * rather than reporting what is wrong with this one.
     */
    return (
      <Panel
        panelTitle="Commcast"
        sections={<EmptyState layout="fill">No host connection</EmptyState>}
      />
    );
  }

  /*
   * Identity, in the header rather than in a body row. It is who this screen
   * is, which the operator needs once and not while reading, so it does not
   * need to cost the thread a row of its height.
   */
  const identity = (
    <Commcast__Identity>
      {/* The editor needs an identity provider; a screen without one still
          posts under its seat's name, shown flat. */}
      {named === undefined ? (
        <Text size="xs">{thread.me.name}</Text>
      ) : (
        <StationNameEditor compact />
      )}
      {/* The kit's `Badge`, not a local square. What stood here was a
          hand-rolled reimplementation of exactly this primitive, which is the
          class of thing `styleguide-duplicate-primitives` exists to stop.
          Carries no severity: a seat is an identity, and dressing "ABOARD" as
          `nominal` would put a green go-pill on a fact that is neither good
          nor bad and would contribute a meaningless rank to the panel's status
          summary. No severity renders the kit's decorative chip, which is what
          an identity is. The pilot-versus-ground COLOUR survives where it is
          load-bearing, on the author names in the thread. */}
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
     * `fill`, because a thread is the tile. Without it the section keeps its
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
              {/* At the HEAD, because the front of the thread is where the drop
                happened. A thread that forgets has to say it forgot, and
                saying so in a footnote under the composer put it as far from
                the gap as the widget allows. */}
              {dropped > 0 && (
                <ThreadMarker>
                  {dropped} earlier message{dropped === 1 ? "" : "s"} dropped at
                  the cap
                </ThreadMarker>
              )}
              {feed.revealed.length === 0 && feed.inTransit.length === 0 && (
                <EmptyState>Nothing spoken yet.</EmptyState>
              )}
              {feed.revealed.map((msg) => (
                <MessageRow
                  key={msg.id}
                  msg={msg}
                  me={me}
                  utNow={utNow}
                  pairs={pairs}
                  thread={thread}
                  oneWaySeconds={oneWaySeconds}
                />
              ))}
              {feed.unreachable.length > 0 && (
                <Commcast__Group>
                  <GroupLabel $warn>
                    Never reached you ({feed.unreachable.length})
                  </GroupLabel>
                  {feed.unreachable.map((msg) => (
                    <UnreachableRow key={msg.id} msg={msg} />
                  ))}
                </Commcast__Group>
              )}
              {/* At the TAIL, and a rule rather than a row: it terminates what
                this seat knows was said. Everything above it arrived; past it
                there may be words nobody here has heard. That is a different
                claim from an in-transit message, which is one specific
                utterance with an instant it lands at, and the two must not
                read alike. */}
              {noSignal && <ThreadMarker $blocked>no signal</ThreadMarker>}
            </Commcast__List>
          </Commcast__Scroll>
        </ConsoleFrame>

        {/* PINNED between the thread and the composer rather than inside the
          scroll, where the terminal widget puts its uplink queue. A transit list
          inside the scroll takes the thread's bottom as it grows, which is the
          part the operator is reading. It is not `InFlightList`: see the note
          on `TransitRow`. */}
        {feed.inTransit.length > 0 && (
          <Commcast__Transit>
            <GroupLabel>In transit ({feed.inTransit.length})</GroupLabel>
            {feed.inTransit.map((msg) => (
              <TransitRow
                key={msg.id}
                msg={msg}
                me={me}
                utNow={utNow}
                pairs={pairs}
                mine={msg.authorStationKey === thread.me.stationKey}
              />
            ))}
          </Commcast__Transit>
        )}

        <Composer
          thread={thread}
          utNow={utNow}
          oneWaySeconds={oneWaySeconds}
          vantageId={me.vantageId}
        />
        <ReadReceipts thread={thread} feed={feed} utNow={utNow} />
      </Commcast__Frame>
    </Section>
  );

  return <Panel panelTitle="Commcast" panelAside={identity} sections={body} />;
}

/** One message that has arrived here. */
function MessageRow({
  msg,
  me,
  utNow,
  pairs,
  thread,
  oneWaySeconds,
}: {
  msg: CommsMessage;
  me: Vantage;
  utNow: number | undefined;
  pairs: SeparationMatrix | undefined;
  thread: CommcastThread;
  oneWaySeconds: number | null;
}) {
  const sep = separationFor(msg, me, pairs);
  const receipts = msg.readBy.length;
  const mine = msg.authorStationKey === thread.me.stationKey;
  return (
    <Commcast__Message>
      <Commcast__Meta>
        <Author $pilot={msg.authorSeat === "pilot"}>{msg.authorName}</Author>
        {sep.kind === "light-time" && sep.seconds > 0 && (
          <Text size="xs" tone="info">
            took {formatDuration(sep.seconds)}
          </Text>
        )}
        {sep.kind === "unmeasured" && (
          <Text size="xs" tone="warn">
            separation to that centre is unpublished
          </Text>
        )}
        {receipts > 0 && (
          <Text size="xs" tone="faint">
            read by {receipts}
          </Text>
        )}
      </Commcast__Meta>
      <Commcast__Body>{msg.body}</Commcast__Body>
      {mine && msg.oneWaySeconds === null && (
        <WentNowhere
          msg={msg}
          thread={thread}
          utNow={utNow}
          oneWaySeconds={oneWaySeconds}
        />
      )}
    </Commcast__Message>
  );
}

/**
 * One message spoken but still crossing to this seat.
 *
 * Deliberately NOT a `ui-kit` `InFlightList` row, though the shape is close
 * enough to be tempting. That component describes a delayed COMMAND, whose
 * phases are the reach-and-reply geometry of a round trip: `awaiting-reply`
 * and `overdue` have no meaning for a one-way utterance, and its `lost` is a
 * different fact from this thread's no-path, which is a permanent row rather
 * than a queue entry. It is also transient by design, an item leaves it on
 * arrival and nothing remains, where a message has to arrive IN PLACE and stay
 * in the order it reached this seat. Same call the terminal widget makes about
 * `CommandDelay`: a surface that is already its own delay UX does not want a
 * second one arguing with it.
 */
function TransitRow({
  msg,
  me,
  utNow,
  pairs,
  mine,
}: {
  msg: CommsMessage;
  me: Vantage;
  utNow: number | undefined;
  pairs: SeparationMatrix | undefined;
  mine: boolean;
}) {
  const delivery = deliveryFor(
    msg,
    me,
    utNow ?? Number.NEGATIVE_INFINITY,
    pairs,
  );
  const remaining =
    delivery.state === "in-transit" && utNow !== undefined
      ? delivery.revealUt - utNow
      : null;
  return (
    <Commcast__Message $dim>
      <Commcast__Meta>
        <Author $pilot={msg.authorSeat === "pilot"}>{msg.authorName}</Author>
        <Text size="xs" tone="info">
          {remaining === null
            ? "lands when the clock is known"
            : `lands in ${formatDuration(Math.max(0, remaining))}`}
        </Text>
      </Commcast__Meta>
      {/* Own words are readable in flight; someone else's have not arrived, so
          showing them here would be the faster-than-light channel this whole
          design exists to avoid. What used to stand in for the withheld body
          was a null-value dash, which READS as a separator rather than as
          absence. A row with no body line at all is visibly shorter than a
          message, which is the honest signal: there is nothing here to read
          yet. */}
      {mine && <Commcast__Body>{msg.body}</Commcast__Body>}
    </Commcast__Message>
  );
}

/**
 * One message spoken at a vantage with no path to this one.
 *
 * The body is WITHHELD, the same as an in-transit one, and by the same means:
 * no body line is rendered. It did not reach this seat and never will, so
 * printing it here would be the faster-than-light channel the whole design
 * exists to avoid. What the operator is told is that somebody said something
 * they cannot hear, which is itself a fact about the link worth having.
 */
function UnreachableRow({ msg }: { msg: CommsMessage }) {
  return (
    <Commcast__Message $dim>
      <Commcast__Meta>
        <Author $pilot={msg.authorSeat === "pilot"}>{msg.authorName}</Author>
        <Text size="xs" tone="nogo">
          no path from where it was spoken
        </Text>
      </Commcast__Meta>
    </Commcast__Message>
  );
}

/**
 * The author's own message that reached nobody else.
 *
 * It is REVEALED here, because the author is standing next to it, so it is
 * flagged in place rather than filed under a heading. Without this the author
 * would watch their own words sit in the thread looking delivered while nobody
 * anywhere received them, which is the failure the mod's blackout precedent
 * gets wrong for a person's words: it drops the backlog on reconnect, right for
 * telemetry and wrong here.
 */
function WentNowhere({
  msg,
  thread,
  utNow,
  oneWaySeconds,
}: {
  msg: CommsMessage;
  thread: CommcastThread;
  utNow: number | undefined;
  oneWaySeconds: number | null;
}) {
  return (
    <Commcast__Retry>
      <Text size="xs" tone="nogo">
        no path home when sent: nobody else received this
      </Text>
      <Button
        disabled={utNow === undefined || oneWaySeconds === null}
        onClick={() => {
          if (utNow === undefined) return;
          thread.send({
            kind: "text",
            ...(msg.body === undefined ? {} : { body: msg.body }),
            sentUt: utNow,
            oneWaySeconds,
            ...(thread.me.vantageId === undefined
              ? {}
              : { authorVantageId: thread.me.vantageId }),
          });
        }}
      >
        {oneWaySeconds === null ? "Still no path" : "Say it again"}
      </Button>
    </Commcast__Retry>
  );
}

function Composer({
  thread,
  utNow,
  oneWaySeconds,
  vantageId,
}: {
  thread: CommcastThread;
  utNow: number | undefined;
  oneWaySeconds: number | null;
  vantageId: string | undefined;
}) {
  const [draft, setDraft] = useState("");
  const ready = draft.trim().length > 0 && utNow !== undefined;
  const submit = () => {
    if (!ready || utNow === undefined) return;
    thread.send({
      kind: "text",
      body: draft.trim(),
      // The sender's own present. NOT `confirmedEdgeUt()`, which is already a
      // light-time behind and would push every reveal out to a round trip.
      sentUt: utNow,
      // Frozen here and never re-read: a changing delay must not un-deliver
      // something already promised.
      oneWaySeconds,
      ...(vantageId === undefined ? {} : { authorVantageId: vantageId }),
    });
    setDraft("");
  };
  const noPath = oneWaySeconds === null;
  return (
    /* The bar's own outline says whether this is going anywhere, the same way
       the terminal widget's does: with no path home it turns error-toned while
       the operator is still typing, rather than reporting the refusal only
       after they have pressed send. The flag says why an outline has turned
       red, which an outline cannot. */
    <ComposerBar blocked={noPath} {...(noPath ? { flag: "NO PATH" } : {})}>
      <label htmlFor="commcast-draft">
        <VisuallyHidden>Message</VisuallyHidden>
      </label>
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
      <Button disabled={!ready} onClick={submit}>
        {noPath
          ? "Send (no path)"
          : oneWaySeconds > 0
            ? `Send (+${formatDuration(oneWaySeconds)})`
            : "Send"}
      </Button>
    </ComposerBar>
  );
}

/**
 * Marks everything visible here as read, once.
 *
 * A receipt is delayed back across the same separation when it renders, so
 * recording it the moment the operator can see the message is the honest
 * instant: what is delayed is the other end LEARNING it, not the reading.
 */
function ReadReceipts({
  thread,
  feed,
  utNow,
}: {
  thread: CommcastThread;
  feed: { revealed: readonly CommsMessage[] };
  utNow: number | undefined;
}) {
  const acked = useRef<Set<string>>(new Set());
  const mine = thread.me.stationKey;
  const unread = useMemo(
    () =>
      feed.revealed
        .filter(
          (m) =>
            m.authorStationKey !== mine &&
            !acked.current.has(m.id) &&
            !m.readBy.some((r) => r.stationKey === mine),
        )
        .map((m) => m.id),
    [feed.revealed, mine],
  );
  useEffect(() => {
    if (unread.length === 0 || utNow === undefined) return;
    for (const id of unread) acked.current.add(id);
    thread.markRead(unread, utNow);
  }, [unread, utNow, thread]);
  return null;
}

/** How many messages this thread has dropped at the cap, reactively. */
function useDroppedCount(thread: CommcastThread | null): number {
  const [dropped, setDropped] = useState(
    () => thread?.snapshot().droppedCount ?? 0,
  );
  useEffect(() => {
    if (!thread) return;
    setDropped(thread.snapshot().droppedCount);
    return thread.subscribe((snap) => setDropped(snap.droppedCount));
  }, [thread]);
  return dropped;
}

/**
 * The widget mounts its own provider so it works wherever it is placed,
 * including a screen that never wired one. On the host the provider finds the
 * service through context; on a peer it builds a client over the peer link.
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
 * The thread's own inset, and its anchor. `ConsoleFrame` draws to its border
 * with no gutter, which is right for a terminal emulator and wrong for text,
 * so the padding goes on the scrolling children rather than on the frame.
 *
 * The inner is made a flex column so `Commcast__List` can take a `margin-top:
 * auto` and sit against the BOTTOM of the frame, next to the composer, growing
 * upward as the thread fills. A short thread otherwise starts at the top with
 * the empty space between the newest line and the box it is typed into, which
 * is the opposite of how the terminal this is aligned with reads. The auto
 * margin resolves to zero once the thread is taller than the frame, so a full
 * thread scrolls exactly as before.
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
  /* See the scroll wrapper above: pins a short thread to the frame's bottom. */
  margin-top: auto;
  gap: var(--space-6);
`;

/*
 * A boundary in the thread, not a row in it. A message is an author, a stamp
 * and words; this is a rule across the column with a word on it, so the two
 * can never be misread for one another. Two uses, at the two ends: what the
 * thread has forgotten off the front, and where what this seat knows stops.
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

// The pinned in-transit strip, outside the scroll. Never grows: it is one
// short row per message still crossing, and the thread beneath keeps the rest.
const Commcast__Transit = styled.div`
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  gap: var(--space-4);
`;

const Commcast__Group = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  border-top: 1px solid var(--color-border-subtle);
  padding-top: var(--space-6);
`;

const GroupLabel = styled.span<{ $warn?: boolean }>`
  font-size: var(--font-size-2xs);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: ${({ $warn }) =>
    $warn ? "var(--color-status-nogo-fg)" : "var(--color-text-dim)"};
`;

const Commcast__Message = styled.div<{ $dim?: boolean }>`
  display: flex;
  flex-direction: column;
  gap: var(--space-hair);
  opacity: ${({ $dim }) => ($dim ? 0.65 : 1)};
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

const Commcast__Retry = styled.div`
  display: flex;
  align-items: center;
  gap: var(--space-6);
  flex-wrap: wrap;
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
    "The shared text thread between every command centre and every pilot on this mission. Each message reveals at the light-time between where it was spoken and where you are reading, so the two ends genuinely see different threads.",
  tags: ["mission-control", "comms"],
  defaultSize: { w: 6, h: 8 },
  minSize: { w: 4, h: 5 },
  component: CommcastWidget,
  // `comms.delay` is what a message freezes its separation from at send. It is
  // TrueNow and never itself delay-gated, so it is the current number at the
  // instant the operator presses send. `comms.link` is what terminates the
  // thread: a confirmed loss of line of sight means there may be words this
  // seat has not heard, which is a different claim from a message in transit.
  channels: ["comms.delay", "commandCentre.separation", "comms.link"],
  // Aboard AND on the ground: the whole point is that both ends are in it.
  seats: ["mission-control", "pilot"],
  defaultConfig: {},
  actions: [],
  pushable: false,
});

export { CommcastWidget };
