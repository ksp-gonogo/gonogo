import { Console, EmptyState } from "@ksp-gonogo/ui-kit";
import type { ReactNode } from "react";
import { CommcastBackButton } from "./CommcastBackButton";
import { CommcastComposer } from "./CommcastComposer";
import type { useLocalParticipant } from "./CommcastContext";
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
import { outboundItems } from "./outboundItems";
import { RadioMute } from "./radio/RadioMute";
import { RadioPtt } from "./radio/RadioPtt";
import type { RadioControl } from "./radio/useRadio";
import type { Separation, SeparationMatrix, Vantage } from "./reveal";
import type { CommcastThread } from "./threads";
import type { RecipientId } from "./types";

/** One conversation. The way back is in the body rather than the panel aside, which collapses at narrow widths. */
export function CommcastThreadView({
  thread,
  me,
  utNow,
  pairs,
  log,
  noSignal,
  nameFor,
  local,
  radio,
  indicator,
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
  /** The widget's one radio, which hears every conversation whichever view is open. */
  radio: RadioControl;
  indicator: ReactNode;
  separation: Separation;
  separationSeconds: number | null;
  target: RecipientId | null;
  onBack: () => void;
}) {
  const noPath = separation.kind === "no-path";
  const threadName = thread.with.map(nameFor).join(", ");
  return (
    <>
      {/*
        The radio sits at the far end of the bar, away from the input. The lamp
        is left of the pinned pair because it grows a name per live loop, and
        inside the pair it would shove talk and mute under the pointer.
      */}
      <Commcast__Bar>
        <CommcastBackButton onClick={onBack} />
        <Commcast__BarTitle>{threadName}</Commcast__BarTitle>
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
        inFlight={outboundItems(thread.outbound, me, utNow, pairs)}
        inFlightFrozenAtDispatch
        composer={
          <CommcastComposer
            log={log}
            me={me}
            local={local}
            utNow={utNow}
            target={target}
            noPath={noPath}
            separationSeconds={separationSeconds}
          />
        }
      >
        <Commcast__Scroll>
          <Commcast__List>
            {thread.entries.length === 0 && thread.outbound.length === 0 && (
              <EmptyState>No messages.</EmptyState>
            )}
            {thread.entries.map((entry) => (
              <CommcastMessageRow
                key={entry.msg.id}
                entry={entry}
                me={me}
                utNow={utNow}
                pairs={pairs}
                log={log}
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
