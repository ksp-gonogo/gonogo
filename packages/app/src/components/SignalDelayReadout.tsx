import { useTelemetry, useTimeContexts } from "@ksp-gonogo/core";
import {
  useObservedVantage,
  useSelectedVantage,
} from "@ksp-gonogo/sitrep-client";
import { value } from "@ksp-gonogo/sitrep-sdk";
import { useOwnCraftVantage } from "@ksp-gonogo/sitrep-sdk/spine";
import { NULL_DISPLAY, Text, Unit, VisuallyHidden } from "@ksp-gonogo/ui-kit";
import { useActiveCentres } from "./VantageControl";

/** What the header can truthfully say about the delay in force. */
type SignalDelayState =
  | { kind: "delay"; seconds: number }
  | { kind: "disconnected" }
  | { kind: "link-unknown" }
  | { kind: "unreported" };

/**
 * The header's delay decision, as arithmetic over what the screen knows.
 *
 * `owltSeconds` is the view clock's own delay, so this never re-derives a
 * number from `comms.delay`. That authority holds its last light-time through a
 * blackout, which is right for the clock and would be a falsehood in a readout,
 * so a link reported down wins over it. A link not yet observed is not a link
 * that is up, and gets no number either.
 *
 * The clock's number is one global reading: the active craft's path home, plus
 * a zero when the session stands on that craft. The mod times every other
 * centre by its own route, and that route is not on the wire, so a centre that
 * is neither home nor the craft itself is `unreported` rather than quoted home's
 * figure.
 *
 * A craft is no distance from itself, so the own-craft case is a zero whatever
 * the link home says.
 */
function deriveSignalDelay({
  owltSeconds,
  linkConnected,
  ownCraftVantage,
  observedIsHome,
}: {
  owltSeconds: number;
  linkConnected: boolean | undefined;
  ownCraftVantage: boolean;
  observedIsHome: boolean;
}): SignalDelayState {
  if (ownCraftVantage) return { kind: "delay", seconds: owltSeconds };
  if (linkConnected === false) return { kind: "disconnected" };
  if (linkConnected === undefined) return { kind: "link-unknown" };
  if (!observedIsHome) return { kind: "unreported" };
  return { kind: "delay", seconds: owltSeconds };
}

/**
 * The one-way signal delay from the observed command centre to the active
 * craft, for the dashboard header.
 *
 * Not a live region: the strip it sits in deliberately is not one, and a delay
 * that moves with the craft would announce on every change.
 */
export function SignalDelayReadout() {
  /*
   * Split on the selection the same way `OwnCraftDelayGate` is, so a screen
   * that has chosen no vantage does not subscribe `vessel.orbit` just to learn
   * it is not standing on the craft.
   */
  return useSelectedVantage() === undefined ? (
    <SignalDelayValue ownCraftVantage={false} />
  ) : (
    <OwnCraftAwareSignalDelay />
  );
}

function OwnCraftAwareSignalDelay() {
  return <SignalDelayValue ownCraftVantage={useOwnCraftVantage()} />;
}

function SignalDelayValue({ ownCraftVantage }: { ownCraftVantage: boolean }) {
  const { owltSeconds } = useTimeContexts();
  const { homeId } = useActiveCentres();
  const observed = useObservedVantage();
  const linkReading = useTelemetry("comms.link");
  /*
   * Observed only: silence is evidence about a link, so a stale "connected"
   * is not one. The same read `SignalLossIndicator` and `CommSignal` take.
   */
  const linkConnected =
    linkReading.state === "observed" ? linkReading.value.connected : undefined;

  const state = deriveSignalDelay({
    owltSeconds,
    linkConnected,
    ownCraftVantage,
    observedIsHome: observed !== undefined && observed === homeId,
  });

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
    case "link-unknown":
      return <NoDelay spoken="Signal delay unknown, no link report yet" />;
    case "unreported":
      return (
        <NoDelay spoken="Signal delay from this command centre is not reported" />
      );
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
