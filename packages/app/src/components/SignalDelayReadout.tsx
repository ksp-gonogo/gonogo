import { useScreen, useTelemetry, useTimeContexts } from "@ksp-gonogo/core";
import {
  readCentreDelays,
  readOneWaySeconds,
  useObservedVantage,
  useSelectedVantage,
} from "@ksp-gonogo/sitrep-client";
import { value } from "@ksp-gonogo/sitrep-sdk";
import {
  useLatestValue,
  useOwnCraftVantage,
} from "@ksp-gonogo/sitrep-sdk/spine";
import { NULL_DISPLAY, Text, Unit, VisuallyHidden } from "@ksp-gonogo/ui-kit";
import { useEffect, useState } from "react";
import { usePeerClient } from "../peer/PeerClientContext";
import { useActiveCentres } from "./VantageControl";

/** What the header can truthfully say about the delay in force. */
type SignalDelayState =
  | { kind: "delay"; seconds: number }
  | { kind: "disconnected" }
  | { kind: "unknown"; spoken: string };

const LINK_UNKNOWN = "Signal delay unknown, no link report yet";
const NOT_REPORTED = "Signal delay from this command centre is not reported";

/**
 * The header's delay decision, as arithmetic over what the screen knows about
 * one centre's path to the active craft.
 *
 * `centreDelays` is `commandCentre.activeVesselDelay`: each centre with a delay
 * of its own, or `undefined` before that list has arrived. Home is never on it,
 * because home's delay is `comms.delay`, so `homeSeconds` answers for home. Any
 * other centre the list leaves out has no route to the craft, which is a path
 * that is down, and is said the same way a lost link home is.
 *
 * A link reported down wins over every number, because the number held through
 * a blackout is right for the clock and would be a falsehood in a readout. A
 * link not yet observed is not a link that is up, and gets no number either.
 *
 * A craft is no distance from itself, so a centre that is the craft reads zero
 * whatever the link home says.
 */
function deriveSignalDelay({
  centreId,
  isOwnCraft,
  isHome,
  homeSeconds,
  centreDelays,
  linkConnected,
}: {
  centreId: string | undefined;
  isOwnCraft: boolean;
  isHome: boolean;
  homeSeconds: number | undefined;
  centreDelays: ReadonlyMap<string, number> | undefined;
  linkConnected: boolean | undefined;
}): SignalDelayState {
  if (isOwnCraft) return { kind: "delay", seconds: 0 };
  if (linkConnected === false) return { kind: "disconnected" };
  if (linkConnected === undefined) {
    return { kind: "unknown", spoken: LINK_UNKNOWN };
  }
  if (centreId === undefined) return { kind: "unknown", spoken: NOT_REPORTED };
  if (isHome) {
    return homeSeconds === undefined
      ? { kind: "unknown", spoken: NOT_REPORTED }
      : { kind: "delay", seconds: homeSeconds };
  }
  if (centreDelays === undefined) {
    return { kind: "unknown", spoken: NOT_REPORTED };
  }
  const seconds = centreDelays.get(centreId);
  return seconds === undefined
    ? { kind: "disconnected" }
    : { kind: "delay", seconds };
}

/**
 * The one-way signal delay between the active craft and a command centre, for
 * the dashboard header.
 *
 * Which centre depends on the seat. A command-centre screen shows its own, the
 * one named beside it, whose light-time its view clock runs on. A pilot is
 * aboard the craft, so the distance that matters is to the centre mission
 * control is standing at: how long the pilot's words take to reach the ground,
 * and the ground's to reach them.
 *
 * Not a live region: the strip it sits in deliberately is not one, and a delay
 * that moves with the craft would announce on every change.
 */
export function SignalDelayReadout() {
  if (useScreen() === "pilot") return <PilotSignalDelay />;
  return <CentreSignalDelay />;
}

function CentreSignalDelay() {
  /*
   * Split on the selection the same way `OwnCraftDelayGate` is, so a screen
   * that has chosen no vantage does not subscribe `vessel.orbit` just to learn
   * it is not standing on the craft.
   */
  return useSelectedVantage() === undefined ? (
    <CentreSignalDelayValue ownCraftVantage={false} />
  ) : (
    <OwnCraftAwareSignalDelay />
  );
}

function OwnCraftAwareSignalDelay() {
  return <CentreSignalDelayValue ownCraftVantage={useOwnCraftVantage()} />;
}

/**
 * A command-centre screen's own delay, keyed on the centre the picker shows.
 * Whatever number it prints is the view clock's, which reads the same row, so
 * the header can never quote a light-time the clock is not running on; the
 * list decides only whether this centre has a path at all.
 */
function CentreSignalDelayValue({
  ownCraftVantage,
}: {
  ownCraftVantage: boolean;
}) {
  const { owltSeconds } = useTimeContexts();
  const { homeId } = useActiveCentres();
  const selected = useSelectedVantage();
  const observed = useObservedVantage();
  const centreId = selected ?? observed;
  const linkConnected = useLinkConnected();
  const centreDelays = useCentreDelays();

  const state = deriveSignalDelay({
    centreId,
    isOwnCraft: ownCraftVantage,
    isHome: centreId !== undefined && centreId === homeId,
    homeSeconds: owltSeconds,
    centreDelays,
    linkConnected,
  });
  return (
    <SignalDelayValue
      state={
        state.kind === "delay" ? { kind: "delay", seconds: owltSeconds } : state
      }
    />
  );
}

/**
 * A pilot's delay to the centre mission control stands at. The pilot's own
 * clock runs aboard, at zero, so this reads the latest figures themselves:
 * home's off `comms.delay`, any other centre's off the list.
 */
function PilotSignalDelay() {
  const hostCentre = useHostCommandCentre();
  const aboard = useSelectedVantage();
  const { homeId } = useActiveCentres();
  const linkConnected = useLinkConnected();
  const centreDelays = useCentreDelays();
  const homeSeconds =
    readOneWaySeconds(useLatestValue<unknown>("comms.delay")) ?? undefined;

  const state: SignalDelayState =
    hostCentre === null
      ? {
          kind: "unknown",
          spoken: "Signal delay to mission control unknown, not heard from yet",
        }
      : deriveSignalDelay({
          centreId: hostCentre,
          isOwnCraft: hostCentre === aboard,
          isHome: hostCentre === homeId,
          homeSeconds,
          centreDelays,
          linkConnected,
        });
  return <SignalDelayValue state={state} />;
}

/**
 * Observed only: silence is evidence about a link, so a stale "connected" is
 * not one. The same read `SignalLossIndicator` and `CommSignal` take.
 */
function useLinkConnected(): boolean | undefined {
  const linkReading = useTelemetry("comms.link");
  return linkReading.state === "observed"
    ? linkReading.value.connected
    : undefined;
}

/**
 * Each centre's own delay to the active craft, or `undefined` before the list
 * has arrived. The latest list off the wire, the same one the view clock's
 * delay authority holds, so the header and the clock agree on which centres
 * have a route. It goes quiet exactly while the craft is out of contact, and
 * the link read above is what says so.
 */
function useCentreDelays(): ReadonlyMap<string, number> | undefined {
  const payload = useLatestValue<unknown>("commandCentre.activeVesselDelay");
  if (payload === undefined) return undefined;
  return readCentreDelays(payload) ?? undefined;
}

/** The centre the host's main screen stands at, or `null` before the host has said. */
function useHostCommandCentre(): string | null {
  const peer = usePeerClient();
  const [centreId, setCentreId] = useState<string | null>(
    () => peer?.getHostCommandCentre() ?? null,
  );
  useEffect(() => peer?.onHostCommandCentreChange(setCentreId), [peer]);
  return centreId;
}

function SignalDelayValue({ state }: { state: SignalDelayState }) {
  switch (state.kind) {
    case "delay":
      return (
        <>
          <VisuallyHidden>Signal delay </VisuallyHidden>
          <Unit value={value("s", state.seconds)} />
        </>
      );
    case "disconnected":
      return (
        <>
          <VisuallyHidden>Signal delay: </VisuallyHidden>
          <Text tone="warn" size="xs">
            disconnected
          </Text>
        </>
      );
    case "unknown":
      return <NoDelay spoken={state.spoken} />;
  }
}

/** The null token for the eye, and the reason there is no number for the ear. */
function NoDelay({ spoken }: { spoken: string }) {
  return (
    <>
      <VisuallyHidden>{spoken}</VisuallyHidden>
      <Text tone="muted" size="xs" aria-hidden="true">
        {NULL_DISPLAY}
      </Text>
    </>
  );
}
