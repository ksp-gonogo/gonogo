import {
  type StreamFixture,
  setupStreamFixture,
  stopArriving,
} from "@ksp-gonogo/sitrep-sdk/testing";
import { type ReactNode, useEffect, useState } from "react";

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
    for (const e of emits) stream.emit(e.topic, e.payload);
    if (stopsArriving) stopArriving(stream);
  }, [stream, emits, stopsArriving]);
  return <stream.Provider>{children}</stream.Provider>;
}
