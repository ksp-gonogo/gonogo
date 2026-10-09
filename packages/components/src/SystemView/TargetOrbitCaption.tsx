import type { Value } from "@ksp-gonogo/sitrep-sdk";
import { Unit } from "@ksp-gonogo/ui-kit";
import { FRAME_CAPTION } from "./ContactCaption";
import type { TargetHorizon } from "./targetOrbit";

/** How far the target's drawn path holds, as its provider stated it. */
export function TargetOrbitCaption({
  targetName,
  horizon,
  viewUt,
}: Readonly<{
  targetName: string;
  horizon: TargetHorizon;
  viewUt: Value<"ut"> | undefined;
}>) {
  return (
    <div style={FRAME_CAPTION} data-target-horizon={horizon.kind}>
      {targetName} path <TargetHorizonFact horizon={horizon} viewUt={viewUt} />
    </div>
  );
}

function TargetHorizonFact({
  horizon,
  viewUt,
}: Readonly<{ horizon: TargetHorizon; viewUt: Value<"ut"> | undefined }>) {
  if (horizon.kind === "unbounded") return <>unbounded</>;
  if (horizon.kind === "unspecified") return <>no horizon stated</>;
  return (
    <>
      holds{" "}
      {horizon.untilUt !== null && viewUt !== undefined ? (
        <Unit value={horizon.untilUt.minus(viewUt).max(0)} decimals={0} />
      ) : (
        "to an unstated time"
      )}
      {horizon.drift !== null && (
        <>
          {" "}
          · drift ≤ <Unit value={horizon.drift} decimals={0} />
        </>
      )}
    </>
  );
}

/** Which source the relay graph came from: the game, or one vessel. */
export function CommsSourceCaption({
  source,
  activeVesselId,
  activeVesselName,
}: Readonly<{
  source: string;
  activeVesselId: string | undefined;
  activeVesselName: string | undefined;
}>) {
  return (
    <div style={FRAME_CAPTION} data-comms-source={source}>
      Comms network from{" "}
      {commsSourceLabel(source, activeVesselId, activeVesselName)}
    </div>
  );
}

const VESSEL_SOURCE_PREFIX = "vessel:";

function commsSourceLabel(
  source: string,
  activeVesselId: string | undefined,
  activeVesselName: string | undefined,
): string {
  if (source === "game") return "the game";
  if (!source.startsWith(VESSEL_SOURCE_PREFIX)) return source;
  const guid = source.slice(VESSEL_SOURCE_PREFIX.length);
  if (guid === activeVesselId && activeVesselName) return activeVesselName;
  return `vessel ${guid.slice(0, 8)}`;
}
