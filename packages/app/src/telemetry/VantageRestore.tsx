import { useTelemetry } from "@ksp-gonogo/core";
import {
  useSelectedVantage,
  useTelemetryClientOptional,
} from "@ksp-gonogo/sitrep-client";
import { useEffect, useRef } from "react";

/**
 * Sends the screen's chosen vantage again after the mod refused it as an unknown
 * command centre.
 *
 * A game that is still loading accepts a socket before any crewed centre
 * exists, so the vantage the transport re-asserts on every connect is refused
 * and the session stays at home while the header names another centre. The
 * centre appearing in `commandCentre.roster` is the mod saying it now exists,
 * so that is what the retry waits on. It fires once per roster the mod
 * publishes, so a vantage the mod keeps refusing costs one message per roster
 * rather than a loop.
 *
 * Renders nothing: a binding, not a control.
 */
export function VantageRestore({
  refused,
  onRetry,
}: Readonly<{ refused: boolean; onRetry: () => void }>) {
  const client = useTelemetryClientOptional();
  const chosen = useSelectedVantage();
  const roster = useTelemetry("commandCentre.roster");
  const retriedOn = useRef<unknown>(undefined);

  const listed =
    chosen !== undefined &&
    (roster.state === "observed" || roster.state === "held") &&
    roster.value.some((centre) => centre.active && centre.id === chosen);

  useEffect(() => {
    if (!refused || !listed || !client || chosen === undefined) return;
    if (retriedOn.current === roster) return;
    retriedOn.current = roster;
    onRetry();
    client.setVantage(chosen);
  }, [refused, listed, client, chosen, roster, onRetry]);

  return null;
}
