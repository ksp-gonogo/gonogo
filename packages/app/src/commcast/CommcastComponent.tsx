import type { ComponentProps } from "@ksp-gonogo/core";
import { registerComponent, useTelemetry } from "@ksp-gonogo/core";
import type { Reading } from "@ksp-gonogo/sitrep-client";
import type { CommsDelay } from "@ksp-gonogo/sitrep-sdk";
import { useUtNow } from "@ksp-gonogo/sitrep-sdk/spine";
import {
  Button,
  EmptyState,
  formatDuration,
  Panel,
  ScrollArea,
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
  const delayReading = useTelemetry("comms.delay");
  const oneWaySeconds =
    judgeable<CommsDelay>(delayReading)?.oneWaySeconds?.magnitude ?? null;

  if (!thread) {
    return (
      <Panel panelTitle="Commcast">
        <EmptyState layout="fill">
          No route to the thread. A station reaches it through its host; the
          host screen owns it directly.
        </EmptyState>
      </Panel>
    );
  }

  return (
    <Panel panelTitle="Commcast">
      <Commcast__Frame>
        <Commcast__Chrome>
          {/* The editor needs an identity provider; a screen without one still
              posts under its seat's name, shown flat. */}
          {named === undefined ? (
            <Text size="xs">{thread.me.name}</Text>
          ) : (
            <StationNameEditor compact />
          )}
          <SeatChip $pilot={me.seat === "pilot"}>
            {me.seat === "pilot" ? "ABOARD" : "MISSION CONTROL"}
          </SeatChip>
          <Text size="xs" tone="faint">
            {separationLabel(oneWaySeconds)}
          </Text>
        </Commcast__Chrome>

        <ScrollArea>
          <Commcast__List>
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
              />
            ))}
            {feed.inTransit.length > 0 && (
              <Commcast__Group>
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
              </Commcast__Group>
            )}
            {feed.unsent.length > 0 && (
              <Commcast__Group>
                <GroupLabel $warn>Never sent ({feed.unsent.length})</GroupLabel>
                {feed.unsent.map((msg) => (
                  <UnsentRow
                    key={msg.id}
                    msg={msg}
                    thread={thread}
                    utNow={utNow}
                    oneWaySeconds={oneWaySeconds}
                  />
                ))}
              </Commcast__Group>
            )}
          </Commcast__List>
        </ScrollArea>

        <Composer
          thread={thread}
          utNow={utNow}
          oneWaySeconds={oneWaySeconds}
          vantageId={me.vantageId}
        />
        <Commcast__Footnote>
          Ordered as it reached this seat. Another seat's order differs, and
          neither is the transcript.
          {dropped > 0 &&
            ` ${dropped} older message${dropped === 1 ? "" : "s"} dropped at the cap.`}
        </Commcast__Footnote>
      </Commcast__Frame>
      <ReadReceipts thread={thread} feed={feed} utNow={utNow} />
    </Panel>
  );
}

/** One message that has arrived here. */
function MessageRow({
  msg,
  me,
  utNow,
  pairs,
}: {
  msg: CommsMessage;
  me: Vantage;
  utNow: number | undefined;
  pairs: SeparationMatrix | undefined;
}) {
  const sep = separationFor(msg, me, pairs);
  const receipts = msg.readBy.length;
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
      {utNow !== undefined && msg.sentUt > utNow && (
        <Text size="xs" tone="warn">
          spoken ahead of this clock
        </Text>
      )}
    </Commcast__Message>
  );
}

/** One message spoken but still crossing to this seat. */
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
      {/* Own words are readable in flight; someone else's have not arrived,
          so showing them here would be the faster-than-light channel this
          whole design exists to avoid. */}
      <Commcast__Body>{mine ? msg.body : "—"}</Commcast__Body>
    </Commcast__Message>
  );
}

/** One message the author had no path to send. */
function UnsentRow({
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
  const mine = msg.authorStationKey === thread.me.stationKey;
  return (
    <Commcast__Message $dim>
      <Commcast__Meta>
        <Author $pilot={msg.authorSeat === "pilot"}>{msg.authorName}</Author>
        <Text size="xs" tone="nogo">
          no path home when spoken
        </Text>
      </Commcast__Meta>
      <Commcast__Body>{msg.body}</Commcast__Body>
      {mine && (
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
      )}
    </Commcast__Message>
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
  return (
    <Commcast__Composer>
      <label htmlFor="commcast-draft">
        <VisuallyHidden>Message</VisuallyHidden>
      </label>
      <Commcast__Input
        id="commcast-draft"
        value={draft}
        placeholder={
          utNow === undefined ? "No clock yet" : "Say something to the crew"
        }
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
      />
      <Button disabled={!ready} onClick={submit}>
        {oneWaySeconds === null
          ? "Send (no path)"
          : oneWaySeconds > 0
            ? `Send (+${formatDuration(oneWaySeconds)})`
            : "Send"}
      </Button>
    </Commcast__Composer>
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

function separationLabel(oneWaySeconds: number | null): string {
  if (oneWaySeconds === null) return "no path home";
  if (oneWaySeconds === 0) return "no delay";
  return `${formatDuration(oneWaySeconds)} each way`;
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

const Commcast__Chrome = styled.div`
  display: flex;
  align-items: center;
  gap: var(--space-8);
  flex-wrap: wrap;
`;

const SeatChip = styled.span<{ $pilot: boolean }>`
  font-size: var(--font-size-2xs);
  letter-spacing: 0.1em;
  padding: 1px var(--space-6);
  border-radius: var(--radius-sm);
  border: 1px solid
    ${({ $pilot }) =>
      $pilot ? "var(--color-status-go-fg)" : "var(--color-status-info-fg)"};
  color: ${({ $pilot }) =>
    $pilot ? "var(--color-status-go-fg)" : "var(--color-status-info-fg)"};
`;

const Commcast__List = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
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
  gap: 1px;
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

const Commcast__Composer = styled.div`
  display: flex;
  gap: var(--space-6);
  align-items: center;
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

const Commcast__Footnote = styled.span`
  font-size: var(--font-size-2xs);
  color: var(--color-text-faint);
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
  // instant the operator presses send.
  channels: ["comms.delay", "commandCentre.separation"],
  // Aboard AND on the ground: the whole point is that both ends are in it.
  seats: ["mission-control", "pilot"],
  defaultConfig: {},
  actions: [],
  pushable: false,
});

export { CommcastWidget };
