import type { Reading, SlotProps } from "@ksp-gonogo/sitrep-sdk";
import { registerAugment, useTelemetry } from "@ksp-gonogo/sitrep-sdk";
import {
  Badge,
  Cluster,
  type MeterTone,
  magnitudeOf,
  ReadoutCaption,
  Unit,
} from "@ksp-gonogo/ui-kit";
import type { KerbalismSpaceWeather } from "../__generated__/contract";
import { KERBALISM } from "../uplink";

// ---------------------------------------------------------------------------
// CrewStatus's `crew-status.summary` augment: the ONE whole-widget slot
// (`CrewStatus/index.tsx`'s own doc comment), fed straight off the
// `kerbalism.spaceweather` Topic (no Processor: the same "nothing else
// shares this derivation" reasoning `SpaceWeather/badge.ts` uses for the
// same Topic). A vessel radiation condition affects the WHOLE crew
// together, never one kerbal, so it belongs here rather than on the
// per-kerbal `.survival`/`.badges` slots above.
//
// Mirrors `SpaceWeather`'s own vocabulary (`statusFor` in
// packages/components/src/SpaceWeather/index.tsx) so a vessel already
// showing "Storm in progress"/"Exposed" on its Space Weather widget reads
// consistently here too: a storm in progress is the most severe condition
// (nogo), a high ambient/habitat dose short of a storm is "exposed" (warn).
// Renders nothing when the vessel is sheltered/nominal, so a quiet
// magnetosphere carries no banner clutter above the roster.
// ---------------------------------------------------------------------------

/** rad/h at or above which the crew reads as exposed to a high radiation
 *  environment even without an active storm. Matches SpaceWeather's own
 *  `doseTone` warn threshold. Exported: `ShipSystems/RadiationSection` reuses
 *  it verbatim as the graph's "biological safe threshold" reference line, so
 *  the two widgets never drift onto different numbers for the same call. */
export const HIGH_RADIATION_RAD_PER_HOUR = 0.5;

interface RadiationSummary {
  label: string;
  tone: MeterTone;
}

/**
 * The value a VERDICT may be drawn from: current, or modelled forward to the frame.
 * A stale reading gives nothing, because a judgement cannot be dated: the operator
 * reads a band or a pill as the situation NOW.
 */
function judgeable<T>(reading: Reading<T>): T | undefined {
  if (reading.state === "observed") return reading.value;
  if (reading.state === "reckonable") return reading.reckoned.value;
  return undefined;
}

function radiationSummaryFor(
  weather: KerbalismSpaceWeather | undefined,
): RadiationSummary | null {
  if (!weather) return null;
  if (weather.stormInProgress === true) {
    return { label: "Radiation storm in progress", tone: "nogo" };
  }
  // Habitat dose (post-shielding, what the crew actually absorbs) is the
  // right reading for a CREW status summary; falls back to the ambient
  // reading when the mod hasn't resolved a habitat-specific figure yet.
  const doseRadPerSecond = magnitudeOf(
    weather.habitatRadiationRadPerSecond ?? weather.radiationRadPerSecond,
  );
  // No dose reported means no verdict: a summary that stayed silent because it
  // read an absence as zero would be silent for the wrong reason.
  if (doseRadPerSecond === null) return null;
  const doseRadPerHour = doseRadPerSecond * 3600;
  if (doseRadPerHour >= HIGH_RADIATION_RAD_PER_HOUR) {
    return { label: "High radiation environment", tone: "warn" };
  }
  return null;
}

/**
 * The dose rides beside the condition Badge, not inside it: `Badge` is a
 * `white-space: nowrap` pill by design (every other badge in this codebase
 * is a short, fixed phrase), so a number appended inline overflows the pill
 * the moment the widget is anything less than very wide. A `Cluster` wraps
 * onto a second line instead when the tile is narrow, and keeps the two
 * pieces visually joined when it isn't.
 */
function CrewRadiationSummaryAugment(_props: SlotProps<"crew-status.summary">) {
  // Same judgement as ShipSystems': a survival summary must not report a dose rate
  // it cannot vouch for.
  const weather = judgeable(useTelemetry("kerbalism.spaceweather"));
  const summary = radiationSummaryFor(weather);
  if (!summary) return null;
  const doseValue =
    weather?.habitatRadiationRadPerSecond ?? weather?.radiationRadPerSecond;
  return (
    <Cluster
      gap="xs"
      wrap
      align="center"
      role="status"
      aria-live="polite"
      aria-label="crew radiation status"
    >
      <Badge tone={summary.tone} size="sm">
        {summary.label}
      </Badge>
      {doseValue && (
        <ReadoutCaption>
          <Unit value={doseValue} />
        </ReadoutCaption>
      )}
    </Cluster>
  );
}

registerAugment({
  id: "crew-status-radiation-summary",
  augments: "crew-status.summary",
  component: CrewRadiationSummaryAugment,
  requires: "kerbalism",
  owner: KERBALISM,
});

export { CrewRadiationSummaryAugment, radiationSummaryFor };
