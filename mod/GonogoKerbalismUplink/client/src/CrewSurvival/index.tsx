import type { SlotProps } from "@ksp-gonogo/sitrep-sdk";
import { registerAugment, useProcessor, value } from "@ksp-gonogo/sitrep-sdk";
import {
  Badge,
  Meter,
  type MeterTone,
  Stack,
  speakQuantity,
  writeQuantity,
} from "@ksp-gonogo/ui-kit";
import { KERBALISM } from "../uplink";
import { CREW_SURVIVAL, type KerbalSurvival } from "./processor";

/**
 * CrewManifest's `crew-manifest.survival` augment: fills the base widget's
 * generic per-row survival slot with the per-kerbal death clock / worst
 * rule this Uplink derives (`CREW_SURVIVAL`, processor.ts). Replaces the
 * inline `SurvivalMeters` that used to live in CrewManifest itself, a
 * straight move (not a rewrite of the presentation), now sourced off the
 * Processor instead of a direct `useTelemetry("kerbalism.crew")` read.
 *
 * Matched by `crewIndex` first (the row order CrewManifest renders IS
 * `vessel.crew.crew`'s own order, and so is `CREW_SURVIVAL.kerbals`, both
 * built from the same array), falling back to a name search only if that
 * position's name has drifted (e.g. a future base-widget change that
 * filters/reorders the roster). Renders nothing when the kerbal has neither
 * a rule nor a death clock reported, so a vessel with no Kerbalism data (or
 * a kerbal Kerbalism has nothing to say about yet) leaves the row exactly as
 * the base widget renders it alone.
 */
function CrewSurvivalAugment({
  crewName,
  crewIndex,
}: SlotProps<"crew-manifest.survival">) {
  const survival = useProcessor(CREW_SURVIVAL);
  if (!survival) return null;
  const byIndex = survival.kerbals[crewIndex];
  const kerbal =
    byIndex?.name === crewName
      ? byIndex
      : survival.kerbals.find((k) => k.name === crewName);
  if (!kerbal) return null;
  if (!kerbal.worstRule && kerbal.deathClockSec === null) return null;
  return <SurvivalMeters kerbal={kerbal} />;
}

// A string because it feeds `valueLabel` props, not JSX children.
const pct = (v: number): string =>
  writeQuantity(value("%", v * 100), { decimals: 0 });

/** Title-cases a wire rule name for display, e.g. "co2 poisoning" -> "Co2 poisoning". */
function ruleLabel(name: string): string {
  return name.length > 0 ? name.charAt(0).toUpperCase() + name.slice(1) : name;
}

function clockLabel(kerbal: KerbalSurvival): string {
  if (kerbal.deathClockSec !== null) {
    return `~${speakQuantity(value("s", Math.max(0, kerbal.deathClockSec)))} to fatal`;
  }
  if (kerbal.worstRule) {
    return `${ruleLabel(kerbal.worstRule.name)} ${pct(kerbal.worstRule.fraction)}`;
  }
  return "stable";
}

/**
 * The per-kerbal survival readout: the worst reported rule as a
 * 0..1-toward-fatal meter, plus the derived death-clock/worst-rule badge.
 * Presentational (no hooks besides the parent's `useProcessor`).
 */
function SurvivalMeters({ kerbal }: { kerbal: KerbalSurvival }) {
  const tone: MeterTone = kerbal.tone;
  return (
    <Stack
      gap="xs"
      style={{
        paddingBottom: "var(--space-4)",
        paddingLeft: "var(--space-12)",
      }}
      aria-label="survival meters"
    >
      {kerbal.worstRule && (
        <Meter
          size="sm"
          label={ruleLabel(kerbal.worstRule.name)}
          value={kerbal.worstRule.fraction}
          tone={tone}
          valueLabel={pct(kerbal.worstRule.fraction)}
        />
      )}
      <Badge tone={tone} size="sm">
        {clockLabel(kerbal)}
      </Badge>
    </Stack>
  );
}

registerAugment({
  id: "crew-manifest-survival",
  augments: "crew-manifest.survival",
  component: CrewSurvivalAugment,
  requires: "kerbalism",
  owner: KERBALISM,
});

export { CrewSurvivalAugment };
