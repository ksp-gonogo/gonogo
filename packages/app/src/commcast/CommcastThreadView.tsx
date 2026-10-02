import { Button, Console, EmptyState, PlusIcon } from "@ksp-gonogo/ui-kit";
import type { ReactNode } from "react";
import { Addressees } from "./CommcastAddressee";
import { CommcastBackButton } from "./CommcastBackButton";
import { CommcastComposer } from "./CommcastComposer";
import type { AddressBook, useLocalParticipant } from "./CommcastContext";
import type { CommcastLog } from "./CommcastLog";
import { CommcastMessageRow } from "./CommcastMessageRow";
import {
  COMMCAST_TONE,
  Commcast__Bar,
  Commcast__BarGap,
  Commcast__BarRadio,
  Commcast__BarTitle,
  Commcast__List,
  Commcast__Scroll,
  ThreadMarker,
} from "./commcastStyles";
import { namesOf } from "./groups";
import { outboundItems } from "./outboundItems";
import { RadioMute } from "./radio/RadioMute";
import { RadioPtt } from "./radio/RadioPtt";
import type { RadioControl } from "./radio/useRadio";
import type { Separation, Vantage } from "./reveal";
import type { CommcastThread } from "./threads";
import type { RecipientId } from "./types";

/** One group's thread. The way back is in the body rather than the panel aside, which collapses at narrow widths. */
export function CommcastThreadView({
  thread,
  me,
  utNow,
  log,
  noSignal,
  book,
  local,
  radio,
  indicator,
  separation,
  separationSeconds,
  members,
  onAdd,
  onBack,
}: {
  thread: CommcastThread;
  me: Vantage;
  utNow: number | undefined;
  log: CommcastLog;
  noSignal: boolean;
  book: AddressBook;
  local: ReturnType<typeof useLocalParticipant>;
  /** The widget's one radio, which hears every group this vantage is in whichever view is open. */
  radio: RadioControl;
  indicator: ReactNode;
  separation: Separation;
  separationSeconds: number | null;
  /** Everyone the group's words go to, as this vantage can see them now, its own included. */
  members: readonly RecipientId[];
  /** Choose somebody to add; absent when there is nobody left on the roster to add. */
  onAdd: (() => void) | undefined;
  onBack: () => void;
}) {
  const noPath = separation.kind === "no-path";
  const nameFor = book.nameFor;
  const threadName = namesOf(thread.with, nameFor);
  // Everyone the words go to, other than this vantage, who the roster no longer lists.
  const unreachable = members
    .filter((id) => id !== me.vantageId && book.unreachableOf(id) !== undefined)
    .map(nameFor);
  return (
    <>
      {/*
        The radio sits at the far end of the bar, away from the input. The lamp
        is left of the pinned pair because it grows a name per live loop, and
        inside the pair it would shove talk and mute under the pointer.
      */}
      <Commcast__Bar>
        <CommcastBackButton onClick={onBack} />
        <Commcast__BarTitle>
          <Addressees ids={thread.with} book={book} />
        </Commcast__BarTitle>
        {onAdd && (
          <Button type="button" onClick={onAdd}>
            <PlusIcon size="var(--icon-size-control)" aria-hidden="true" />
            Add
          </Button>
        )}
        <Commcast__BarGap />
        {indicator}
        <Commcast__BarRadio>
          {/* Mute is per loop rather than per view, so it holds wherever the operator navigates. */}
          <RadioMute
            muted={radio.isMuted(thread.key)}
            threadName={threadName}
            onToggle={() =>
              radio.setMuted(thread.key, !radio.isMuted(thread.key))
            }
          />
          <RadioPtt
            radio={radio}
            targetName={threadName}
            separationSeconds={separationSeconds}
          />
        </Commcast__BarRadio>
      </Commcast__Bar>
      {/*
        A message freezes its separation at send and keeps crossing on it, so
        the queue outlives the live reading the delay chip is drawn from, and
        it is the only place outbound words appear until something comes back.
      */}
      <Console
        tone={COMMCAST_TONE}
        oneWaySeconds={separationSeconds}
        inFlight={outboundItems(thread.outbound, utNow, nameFor)}
        inFlightFrozenAtDispatch
        composer={
          <CommcastComposer
            log={log}
            me={me}
            local={local}
            utNow={utNow}
            groupId={thread.key}
            members={members}
            noPath={noPath}
            unreachable={unreachable}
            separationSeconds={separationSeconds}
          />
        }
      >
        <Commcast__Scroll>
          <Commcast__List>
            {thread.entries.length === 0 && thread.outbound.length === 0 && (
              <EmptyState>No messages</EmptyState>
            )}
            {thread.entries.map((entry) => (
              <CommcastMessageRow
                key={entry.msg.id}
                entry={entry}
                utNow={utNow}
                log={log}
                nameFor={nameFor}
                separationSeconds={separationSeconds}
              />
            ))}
            {/* A rule at the tail: past it there may be words this vantage has not heard, which is not a message in transit. */}
            {noSignal && <ThreadMarker $blocked>no signal</ThreadMarker>}
          </Commcast__List>
        </Commcast__Scroll>
      </Console>
    </>
  );
}
