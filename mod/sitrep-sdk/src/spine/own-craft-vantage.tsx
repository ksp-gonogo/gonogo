import { useEffect } from "react";
import type { VesselOrbit } from "../__generated__/contract";
import type { TopicReading } from "../reading";
import { useTelemetryClientOptional } from "./context";
import type { DelayAuthority } from "./delay-authority";
import { useSelectedVantage } from "./use-selected-vantage";
import { useStream } from "./use-stream";

/**
 * Whether a session observing from `selectedVantage` is standing on the very
 * craft it is watching, which is the one case the mod delivers at zero delay.
 *
 * Both arguments are ids in the `commandCentre.roster` vocabulary
 * (`"vessel:<guid>"` / `"ground:<name>"`), so the comparison is a plain string
 * equality and never a format this file restates. `subjectId` is the active
 * craft's own id as the orbit sample names it; a vantage that equals it is a
 * crewed centre aboard that craft.
 *
 * The empty string is not a vantage. `Meta.Vantage` is `""` while the
 * connection sits at no command centre because none is active, and an absent
 * subject arrives the same way, so a bare `===` would call two unknowns a
 * match and hand a ground operator a zero-delay clock on a craft they are
 * nowhere near.
 */
export function isOwnCraftVantage(
  selectedVantage: string | undefined,
  subjectId: string | undefined,
): boolean {
  if (!selectedVantage || !subjectId) return false;
  return selectedVantage === subjectId;
}

/**
 * The craft the samples are about, held through a quiet link: which craft that
 * is does not change because its telemetry stopped arriving.
 *
 * Read off the orbit PAYLOAD's own `meta.source`, `"vessel:<guid>"` as
 * `Sitrep.Host.VesselViewProvider.BuildMeta` stamps it. Never the envelope's
 * `meta.source`: that is the Courier node, the literal `"system"` for every
 * non-fleet topic, which no roster id can equal. Optional-chained because a
 * recording or golden fixture can carry no payload meta at all, and then the
 * subject is unknown.
 */
function subjectOf(reading: TopicReading<VesselOrbit>): string | undefined {
  return reading.state === "observed" || reading.state === "stale"
    ? reading.value.meta?.source
    : undefined;
}

/**
 * Whether THIS session's selected vantage is the craft its own telemetry is
 * about: true for a pilot strapped into the active craft, false for a ground
 * operator whatever centre they picked.
 *
 * Gated on the SELECTED vantage, never the observed one. Observed lags a whole
 * light-time behind the request that moved it, so a clock keyed on it would
 * stay ground-delayed for exactly as long as the delay it is meant to remove,
 * and `PilotVantage` (which sets the vantage) keys on selected for the same
 * reason. The cost is a transient at the moment of the request: `setVantage`
 * tracks optimistically, so between asking and the mod agreeing the clock
 * reads zero while frames are still arriving ground-delayed. That window is
 * bounded by one round trip and errs towards the live reading, where the
 * inverse (holding the ground's light-time over live frames) blanks the page
 * outright once the delay exceeds the timeline's retention.
 *
 * Screen-independent on purpose. The mod's zero row is written for whichever
 * centre IS the active craft (`AuthorityMatrixPass.PopulateActiveVessel`), not
 * for a route, so a main-screen operator who selects the active craft's own
 * vantage is reading live frames too and must be told so.
 */
export function useOwnCraftVantage(): boolean {
  const client = useTelemetryClientOptional();
  const selectedVantage = useSelectedVantage();
  const subjectId = subjectOf(useStream<VesselOrbit>("vessel.orbit"));
  // No client means no session to be at a vantage at all, which is neither the
  // pilot case nor a lie about one: fall through to the wire's own delay.
  if (!client) return false;
  return isOwnCraftVantage(selectedVantage, subjectId);
}

/**
 * Keeps the auto-built clock's `DelayAuthority` told whether this session is
 * watching the craft it is standing on, which is the one case the mod streams
 * at no delay (see `DelayAuthority.setOwnCraftVantage`).
 *
 * A component rather than a hook call in the provider body because
 * `useOwnCraftVantage` reads `vessel.orbit`, and every stream read re-renders
 * its caller on EVERY frame the store mints. In the provider body
 * that would re-render the whole application tree at frame rate; here it
 * re-renders one leaf that draws nothing. Rendered only alongside an
 * auto-built authority: a caller who supplied their own `store` owns its
 * clock's delay wiring whole, the same exemption the `comms.delay`
 * subscription effect above makes.
 *
 * Written from an effect rather than during render so the render stays pure
 * and a StrictMode double-render cannot write twice. The frame of lag that
 * costs is immaterial: the value changes when an operator picks a vantage,
 * not per frame, and the clock re-reads `delaySeconds()` on every one.
 *
 * Split in two so that reading (and so subscribing) `vessel.orbit` happens
 * ONLY once a vantage has been chosen.
 * A session that has chosen none sits wherever the mod put it, which is never
 * the craft's own centre, so the answer is already false and the subject is
 * not worth a subscription. Reading it unconditionally is not a free
 * convenience: it puts `vessel.orbit` on the wire for every session, and the
 * host relay is contractually meant to pull a topic because a screen asked for
 * it and for no other reason (`SitrepPeerRelay.test.tsx` pins exactly that,
 * and caught this).
 *
 * The deferral costs nothing where it matters. `PilotVantage` reads
 * `vessel.orbit` itself before it ever calls `setVantage`, so on a pilot's
 * screen the subject is already subscribed and already known at the instant
 * the vantage changes. Anywhere else the gate simply stays false for the frame
 * or two the first orbit sample takes, which errs towards the wire's own
 * delay: the safe direction, since a wrongly-zero clock is the failure.
 */
export function OwnCraftDelayGate({
  authority,
}: {
  authority: DelayAuthority;
}) {
  const selectedVantage = useSelectedVantage();
  return selectedVantage === undefined ? (
    <OwnCraftDelayIdle authority={authority} />
  ) : (
    <OwnCraftDelayWatch
      authority={authority}
      selectedVantage={selectedVantage}
    />
  );
}

/** No vantage chosen, so nothing to read and nothing to subscribe: hold the wire's own delay. */
function OwnCraftDelayIdle({ authority }: { authority: DelayAuthority }) {
  useEffect(() => {
    authority.setOwnCraftVantage(false);
    return () => authority.setOwnCraftVantage(false);
  }, [authority]);
  return null;
}

/** A vantage is chosen: watch the subject the samples are about and answer whether they are the same craft. */
function OwnCraftDelayWatch({
  authority,
  selectedVantage,
}: {
  authority: DelayAuthority;
  selectedVantage: string;
}) {
  const subjectId = subjectOf(useStream<VesselOrbit>("vessel.orbit"));
  const ownCraftVantage = isOwnCraftVantage(selectedVantage, subjectId);
  useEffect(() => {
    authority.setOwnCraftVantage(ownCraftVantage);
    /*
     * Releasing on unmount matters: the provider swaps this for the idle half
     * whenever the vantage is cleared, and a zero left behind would outlive
     * the vantage that earned it.
     */
    return () => authority.setOwnCraftVantage(false);
  }, [authority, ownCraftVantage]);
  return null;
}
