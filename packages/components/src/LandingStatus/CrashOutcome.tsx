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
  const lost = Array.isArray(crash.partsLost) ? crash.partsLost.length : 0;
  const killed = Array.isArray(crash.kerbalsKilled)
    ? crash.kerbalsKilled.length
    : 0;
  const place = placeOf(crash);
  return (
    <Stack>
      {record && <Text level="muted">Record of the last flight</Text>}
      <Text level="muted">
        {[crash.vesselName, crash.body].filter(Boolean).join(" \u00b7 ")}
      </Text>
      {place && <Text level="muted">{place}</Text>}
      <Text level="muted">
        {[
          lost > 0 ? `${plural(lost, "part", "parts")} lost` : null,
          killed > 0 ? `${plural(killed, "kerbal", "kerbals")} lost` : null,
        ]
          .filter(Boolean)
          .join(" \u00b7 ")}
      </Text>
    </Stack>
  );
}
