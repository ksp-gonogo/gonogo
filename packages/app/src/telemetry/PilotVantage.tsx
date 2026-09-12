import { useTelemetry } from "@ksp-gonogo/core";
import {
  useSelectedVantage,
  useStream,
  useTelemetryClientOptional,
  type VesselState,
} from "@ksp-gonogo/sitrep-client";
import { useEffect } from "react";

/**
 * The vantage id of the craft this page is aboard, or `undefined` until the
 * craft has named itself AND the roster agrees it is a command centre.
 *
 * The id comes off `vessel.state.subjectId`, which is the orbit sample's
 * `meta.source`. The mod stamps that `"vessel:<guid>"` and
 * `Gonogo.KSP.CommandCentres.CrewedVesselSource` mints a crewed centre's id
 * from the same guid the same way, so the two strings are equal by
 * construction rather than by a format this file would otherwise restate.
 *
 * The roster is asked first because `ChannelEngine.HandleSetVantage` refuses
 * an id that is not a currently-active centre while
 * `TelemetryClient.setVantage` tracks the request optimistically: asking for a
 * craft the mod will not accept leaves every reader of `selectedVantage`
 * naming a centre the frames are not from. A craft that is no centre (nobody
 * crewed at a control source, or no antenna anything could ever reach) keeps
 * the ground vantage, which is where its data genuinely comes from.
 */
function usePilotCraftVantageId(): string | undefined {
  const subjectId = useStream<VesselState>("vessel.state")?.subjectId;
  // Same read as `VantageControl`'s `useActiveCentres`, minus the home-centre question this has no use for: a stale roster is still the roster, and only never-arrived is empty.
  const rosterReading = useTelemetry("commandCentre.roster");
  const roster =
    rosterReading.state === "observed" || rosterReading.state === "stale"
      ? rosterReading.value
      : undefined;
  const isActiveCentre = (roster ?? []).some(
    (centre) => centre.active && centre.id === subjectId,
  );
  return isActiveCentre ? subjectId : undefined;
}

/**
 * Pins a pilot's telemetry session to the vantage of the craft they are aboard.
 *
 * Renders nothing: it is a binding, not a control. A pilot holds their own
 * session and therefore their own vantage, and nothing on the page ever
 * selected one, so the session kept `TelemetryClient`'s constructor default of
 * `"ksc"` and a human strapped into the craft read every instrument at the
 * GROUND's light-time. That is the one thing `/pilot` exists to prevent.
 *
 * Gated on the SELECTED vantage rather than the observed one. Observed lags a
 * whole light-time behind the request that moved it, so comparing against it
 * would re-send `set-vantage` (and re-subscribe every active topic with it) on
 * every render until the frames caught up.
 *
 * It only ever moves the vantage ONTO a craft. Losing the reading is not
 * evidence the pilot got out, so a frame that stops arriving leaves the
 * binding where the last one put it, and a vessel switch re-points it as soon
 * as the new craft's own sample names itself.
 */
export function PilotVantage() {
  const client = useTelemetryClientOptional();
  const selected = useSelectedVantage();
  const craftVantageId = usePilotCraftVantageId();

  useEffect(() => {
    if (craftVantageId === undefined || craftVantageId === selected) return;
    client?.setVantage(craftVantageId);
  }, [client, craftVantageId, selected]);

  return null;
}
