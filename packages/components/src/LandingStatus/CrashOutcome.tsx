import {
  Readout,
  ReadoutCaption,
  Section,
  Stack,
  Text,
  writeQuantity,
} from "@ksp-gonogo/ui-kit";
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
 * What stands in the descent's place once the vessel is gone: the crash that ended the flight. After impact the vessel's own readings are gone with it, so this is built from the crash report alone.
 */
export function CrashOutcome({ crash }: Readonly<{ crash: CrashReport }>) {
  const lost = Array.isArray(crash.partsLost) ? crash.partsLost.length : 0;
  const killed = Array.isArray(crash.kerbalsKilled)
    ? crash.kerbalsKilled.length
    : 0;
  const place = placeOf(crash);
  return (
    <Stack>
      <Section role="alert" aria-live="assertive">
        <Readout tone="nogo">
          CRASHED
          <ReadoutCaption>VESSEL DESTROYED</ReadoutCaption>
        </Readout>
      </Section>
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
