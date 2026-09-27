import { useCallback, useEffect, useRef, useState } from "react";
import {
  type CommsDelayLike,
  deriveRailEntry,
  type InFlightCommand,
  liveOneWaySeconds,
  type RailCrossing,
} from "../command-delay";
import { type RailTags, railTagsForTelemetry } from "../rail-tags";
import { type Value, value } from "../unit-system";
import { useTelemetryStoreOptional } from "./context";
import { useLatestValue } from "./use-stream";

/** A transmission the craft has sent, as the caller learned of it. */
export interface SentTransmission {
  /** What the rail row calls it, e.g. the result's title. */
  label: string;
  /** What is being carried, e.g. the research subject's id. */
  subject: string;
  /** The instant the whole transmission has left the craft. */
  sentAt: Value<"ut">;
}

/**
 * The delay-rail handle for transmissions: hand it to `usePanelDelay` exactly
 * as a command handle is handed, and the rail draws each transmission as a row
 * through the same derivation a command's row comes from.
 */
export interface UseTransmissionsResult {
  inFlight: InFlightCommand[];
  tags: RailTags;
  /** The live one-way delay home, `null` when there is none to have. */
  effectiveDelaySeconds: number | null;
  /**
   * Put a transmission on the rail. It crosses under the one-way delay live at
   * this moment, frozen as a queued command's is at dispatch, and leaves the
   * rail when it arrives. With no live delay there is nothing to place it on,
   * so it is not drawn.
   */
  expect(transmission: SentTransmission): void;
}

const TRANSMISSION_TAGS = railTagsForTelemetry("discrete");
const NO_IN_FLIGHT: InFlightCommand[] = [];
const REREAD_MS = 1000;

/**
 * Transmissions crossing home, as rail entries. A transmission is sent, not
 * answered, so its row ends at arrival and never becomes an outcome.
 */
export function useTransmissions(): UseTransmissionsResult {
  const store = useTelemetryStoreOptional();
  const commsDelay = useLatestValue<CommsDelayLike>("comms.delay");
  const oneWay = liveOneWaySeconds(commsDelay);
  const oneWayRef = useRef(oneWay);
  oneWayRef.current = oneWay;
  const [crossings, setCrossings] = useState<RailCrossing[]>([]);
  const nextId = useRef(0);
  const [, setReread] = useState(0);

  const expect = useCallback((transmission: SentTransmission) => {
    const oneWaySeconds = oneWayRef.current;
    if (oneWaySeconds === null) return;
    nextId.current += 1;
    const crossing: RailCrossing = {
      id: `transmission-${nextId.current}`,
      label: transmission.label,
      command: transmission.subject,
      topic: "",
      tags: TRANSMISSION_TAGS,
      sentAt: transmission.sentAt,
      oneWaySeconds: value("s", oneWaySeconds),
    };
    setCrossings((prev) => [...prev, crossing]);
  }, []);

  // Nothing else re-renders this hook when a row arrives, so it re-reads the clock while anything is crossing.
  const crossing = crossings.length > 0;
  useEffect(() => {
    if (!crossing) return;
    const timer = setInterval(() => {
      const now = store?.clock.utNowEstimate() ?? 0;
      setCrossings((prev) => {
        const keep = prev.filter((c) => deriveRailEntry(c, now) !== undefined);
        return keep.length === prev.length ? prev : keep;
      });
      setReread((n) => n + 1);
    }, REREAD_MS);
    return () => clearInterval(timer);
  }, [crossing, store]);

  const nowUt = store?.clock.utNowEstimate() ?? 0;
  const rows = crossings.flatMap((c) => deriveRailEntry(c, nowUt) ?? []);
  return {
    inFlight: rows.length > 0 ? rows : NO_IN_FLIGHT,
    tags: TRANSMISSION_TAGS,
    effectiveDelaySeconds: oneWay,
    expect,
  };
}
