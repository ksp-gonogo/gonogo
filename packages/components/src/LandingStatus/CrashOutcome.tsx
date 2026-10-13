import { Stack, Text, writeQuantity } from "@ksp-gonogo/ui-kit";
import type { LandingModel } from "./useLandingModel";

type CrashReport = NonNullable<LandingModel["crash"]>;

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Where the vessel was when it was lost, as the report states it. */
function placeOf(crash: CrashReport): string {
  const at = [crash.latitude, crash.longitude]
    .filter((v) => v?.isFinite())
    .map((v) => writeQuantity(v, { decimals: 3 }));
  return at.length === 2 ? at.join(", ") : "";
}

/** What was lost in the crash, as the report counts it: "2 parts lost · 1 kerbal lost", empty when the report counts none. */
function lossesOf(crash: CrashReport): string {
  const lost = Array.isArray(crash.partsLost) ? crash.partsLost.length : 0;
  const killed = Array.isArray(crash.kerbalsKilled)
    ? crash.kerbalsKilled.length
    : 0;
  return [
    lost > 0 ? `${plural(lost, "part", "parts")} lost` : null,
    killed > 0 ? `${plural(killed, "kerbal", "kerbals")} lost` : null,
  ]
    .filter(Boolean)
    .join(" \u00b7 ");
}

/**
 * The crash that ended the flight as one line, for the row the descent already keeps for the body: the vessel, the body and its air, and what was lost. Where it came to rest is in the tooltip. The line never wraps, so a crash arriving moves nothing on the tile. Used by the landing readout while its touchdown plots are still on screen.
 */
export function CrashLine({
  crash,
  context,
}: Readonly<{
  /** The crash report. */
  crash: CrashReport;
  /** The body and its air, as the descent row writes them. */
  context: string;
}>) {
  const line = [crash.vesselName, context, lossesOf(crash)]
    .filter(Boolean)
    .join(" \u00b7 ");
  const place = placeOf(crash);
  return (
    <Text
      level="muted"
      size="xs"
      data-tooltip={place ? `${line} \u00b7 ${place}` : line}
      style={{
        minWidth: 0,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}
    >
      {line}
    </Text>
  );
}

/**
 * The crash that ended the flight, from the crash report alone: the vessel's own readings go with it, or what is left of it reports as if it had landed. The hero above says the vessel crashed; this says which vessel, where and what was lost.
 */
export function CrashOutcome({
  crash,
  record = false,
}: Readonly<{
  crash: CrashReport;
  /** True once the game has left the flight scene, so this is the record of a flight that is over. */
  record?: boolean;
}>) {
  const place = placeOf(crash);
  return (
    <Stack>
      {record && <Text level="muted">Record of the last flight</Text>}
      <Text level="muted">
        {[crash.vesselName, crash.body].filter(Boolean).join(" \u00b7 ")}
      </Text>
      {place && <Text level="muted">{place}</Text>}
      <Text level="muted">{lossesOf(crash)}</Text>
    </Stack>
  );
}
