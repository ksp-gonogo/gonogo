import {
  type StreamFixture,
  setupStreamFixture,
  stopArriving,
} from "@ksp-gonogo/sitrep-sdk/testing";
import { type ReactNode, useEffect, useState } from "react";
import {
  type CommandAnswers,
  installCommandAnswers,
} from "../../components/scripts/probe/commandAnswers";

/** One emission onto the stream. */
export interface FixtureEmit {
  topic: string;
  payload: unknown;
}

export interface FixtureStreamProps {
  /** Topics held subscribed from the start, so an emit on one no widget reads still lands. */
  subscribed: readonly string[];
  /** Emitted once the tree has mounted, in order. */
  emits?: readonly FixtureEmit[];
  /** What the craft does when a command is sent, by command name: the emits that follow it. */
  answers?: CommandAnswers;
  /** Drop the link after the emits land, so every reading is held. */
  stopsArriving?: boolean;
  /** The view clock's pinned instant. */
  pinnedUt?: number;
  children: ReactNode;
}

/**
 * A real telemetry stream around `children`, fed by hand: the sdk's own
 * `setupStreamFixture`, the adapter an Uplink's tests use.
 */
export function FixtureStream({
  subscribed,
  emits = [],
  answers,
  stopsArriving = false,
  pinnedUt = 1_000_000,
  children,
}: FixtureStreamProps) {
  const [stream] = useState<StreamFixture>(() => {
    const fixture = setupStreamFixture({ pinnedUt });
    for (const topic of subscribed) fixture.subscribe(topic);
    return fixture;
  });
  useEffect(() => {
    if (!answers) return;
    return installCommandAnswers(
      {
        transport: stream.transport,
        emit: (topic, payload, meta) => stream.emit(topic, payload, meta),
      },
      answers,
    );
  }, [stream, answers]);
  useEffect(() => {
    for (const e of emits) stream.emit(e.topic, e.payload);
    if (stopsArriving) stopArriving(stream);
  }, [stream, emits, stopsArriving]);
  return <stream.Provider>{children}</stream.Provider>;
}
