import { registerAugment } from "@ksp-gonogo/sitrep-sdk";
import {
  Badge,
  Cluster,
  KSP_DAY_SECONDS,
  Section,
  type Severity,
  Stack,
  Text,
} from "@ksp-gonogo/ui-kit";
import { KERBALISM } from "../uplink";

/**
 * Greenhouse section, the built-in filler for the `life-support.sections`
 * augment slot (see `ShipSystems/index.tsx`'s slot doc comment). Registered as
 * an ordinary augment rather than baked into the host body so a future
 * non-Kerbalism life-support source can leave the slot empty with no code
 * change on either side, matching every other `*.sections` slot's contract.
 *
 * Renders ONLY the fields Kerbalism's own `Greenhouse.Data` class actually
 * carries (`natural`, `artificial`, `issue`) plus the part's persisted
 * `active` toggle and its derived continuous food-production rate. There is
 * deliberately NO growth meter and NO time-to-harvest countdown anywhere in
 * this file, neither concept exists in the module (production is
 * continuous via a ResourceRecipe, not a discrete harvest event); grounded
 * against `src/Kerbalism/Modules/Greenhouse.cs`.
 *
 * `natural` and `artificial` are NEVER summed or combined into one figure:
 * the real lighting gate is `natural + artificial >= light_tolerance`, so a
 * lamp only ever needs to cover the shortfall against the sun, not double
 * the total. Presenting a combined number would misrepresent that as "more
 * light is always better," when a bright lamp on an already-lit greenhouse
 * contributes nothing the sun wasn't already providing.
 *
 * NOT YET fed by live data: `GonogoKerbalismUplink`'s capture pipeline does
 * not populate `kerbalism.lifesupport.greenhouses` yet, see
 * `KerbalismLifeSupport.Greenhouses`'s own doc comment in
 * `mod/Sitrep.Contract/KerbalismPayloads.cs`. This section is wired and
 * fixture-tested against the wire shape now so the mod-side capture has
 * something real to land into; on an unmodified Kerbalism install today the
 * field arrives as `undefined`, the widget's own `useLifeSupport`/processor
 * treats that as "no greenhouse fitted," and this component's early return
 * means the slot renders nothing, exactly like a vessel with no greenhouse
 * part.
 *
 * Lives inside the Uplink (not `@ksp-gonogo/components`): life support is a
 * Kerbalism concept and never belonged in the base component library. This
 * file moved here alongside the Ship Systems rebuild, replacing the deleted
 * `packages/components/src/LifeSupportSystems/` widget, which owned this
 * augment before.
 */

/** One active Greenhouse part's growing state, the shape the host widget
 *  passes down as this slot's props. */
export interface GreenhouseRow {
  cropResource: string;
  /** Natural light flux reaching the greenhouse, W/m^2. */
  natural: number;
  /** Supplemental lamp light flux, W/m^2. */
  artificial: number;
  /** The player's own on/off toggle, independent of whether it is currently producing. */
  active: boolean;
  /** Blocking reason string, e.g. "insufficient lighting". Empty when growing normally. */
  issue: string;
  /** Derived continuous production rate, units/s (0 when inactive or blocked). */
  foodRatePerSec: number;
  /** rad/s. `<= 0` means "not reported": never flag against it. */
  radiationToleranceRadPerSec: number;
}

export interface LifeSupportSlotContext {
  /** Active Greenhouse parts on the vessel; empty when none are fitted. */
  greenhouses: readonly GreenhouseRow[];
  /**
   * Current ambient (unshielded) dose rate, rad/s, from
   * `kerbalism.spaceweather`. Ambient, not the crew's shielded/habitat
   * figure: a greenhouse part's own tolerance is a limit on what's hitting
   * the HULL, not on what the vessel's habitat shielding lets through to
   * the crew. 0 when no spaceweather frame has landed yet, which never
   * trips a threshold check on its own.
   */
  ambientRadiationRadPerSecond: number;
}

// Declaration-merge the slot id → props type into the sdk facade's
// `SlotRegistry`. Co-located here (not centralised in
// `mod/sitrep-sdk/src/api/slots.ts`, unlike a packages/components-owned
// slot) because this augment is now the Uplink's OWN, this file is always
// part of Kerbalism's own compiled program, so there is no cross-package
// reachability problem for the slot's OWNER (see slots.ts's own header for
// the full reasoning, and Scanning/index.tsx for the matching pattern). This
// is what types `registerAugment({ augments: "life-support.sections", ... })`
// and `<AugmentSlot name="life-support.sections" props={...} />` against
// `LifeSupportSlotContext` rather than the loose fallback.
declare module "@ksp-gonogo/sitrep-sdk" {
  interface SlotRegistry {
    "life-support.sections": LifeSupportSlotContext;
  }
}

function fmtWm2(n: number): string {
  return `${Math.round(n)} W/m²`;
}

/** Converts the per-second production rate to a per-day figure, more
 *  legible than a tiny per-second fraction for a continuous crop process.
 *  The day is Kerbin's 6h one, so this agrees with the time-to-empty
 *  countdown in the same widget. */
function fmtRatePerDay(perSec: number): string {
  if (perSec <= 0) return "0/day";
  const perDay = perSec * KSP_DAY_SECONDS;
  return `${perDay >= 10 ? perDay.toFixed(0) : perDay.toFixed(2)}/day`;
}

/**
 * `tooHigh` (this widget's own client-side ambient-vs-tolerance check, see
 * `radiationTooHigh` below) folds into BOTH the tone and the state label,
 * not just the standalone "Radiation too high" badge: grounded against
 * Kerbalism's own `Greenhouse.SimulateGreenhouse`
 * (`src/Kerbalism/Modules/Greenhouse.cs`), exceeding `radiation_tolerance`
 * makes the module return before it ever queues the food `ResourceRecipe`,
 * i.e. production HALTS outright for that tick, the same as a lighting or
 * pressure failure, not a mere slowdown. Without folding `tooHigh` in here,
 * a growing greenhouse whose mod-reported `issue` field hasn't yet caught
 * up (see this file's own "NOT YET fed by live data" doc comment) could
 * show "Growing" right next to a "Radiation too high" badge, an operator-
 * visible contradiction: this widget's own real bug, not a hypothetical.
 * `warning`, not `critical`: a greenhouse halt is recoverable once the
 * storm passes, the same rung the host widget's Degraded status folds it
 * into. "Growing" and "Off" carry NO severity (decorative grey chips):
 * ordinary operating states earn no colour, the same resting-tone rule the
 * host's process list follows.
 */
function greenhouseTone(
  g: GreenhouseRow,
  tooHigh: boolean,
): Severity | undefined {
  if (!g.active) return undefined;
  return g.issue.length > 0 || tooHigh ? "warning" : undefined;
}

function greenhouseStateLabel(g: GreenhouseRow, tooHigh: boolean): string {
  if (!g.active) return "Off";
  if (tooHigh) return "Halted";
  return g.issue.length > 0 ? "Blocked" : "Growing";
}

/**
 * Instantaneous threshold flag, never a trend: a greenhouse carries no
 * radiation memory of its own (unlike a crew rule, which accumulates), so
 * this reads only the CURRENT ambient rate against the part's own fixed
 * tolerance, no history involved. `<= 0` on either side means "nothing to
 * compare" (an unreported tolerance, or no spaceweather frame yet) and
 * never flags.
 *
 * This is a genuine HALT, not a degrade: verified against Kerbalism's own
 * `Greenhouse.SimulateGreenhouse` (`src/Kerbalism/Modules/Greenhouse.cs`),
 * which returns before queuing the food `ResourceRecipe` whenever
 * `radiation > radiation_tolerance` (same early-return as a lighting or
 * pressure failure), and sets its own `issue` string to "excessive
 * radiation" (`KERBALISM_Greenhouse_issue3`). Production resumes on its own
 * once the ambient rate drops back under tolerance, no manual re-arm
 * needed, so `greenhouseStateLabel`/`greenhouseTone` fold this flag in
 * directly rather than treating it as a side note next to "Growing".
 */
function radiationTooHigh(
  g: GreenhouseRow,
  ambientRadiationRadPerSecond: number,
): boolean {
  return (
    g.radiationToleranceRadPerSec > 0 &&
    ambientRadiationRadPerSecond > g.radiationToleranceRadPerSec
  );
}

/**
 * ONE greenhouse entry, rendered in the same two-line-per-item budget as the
 * Processes section above it (a title/badge row + a single compact value
 * line) so a fully-populated widget (broken process + habitat detail +
 * greenhouse + power) still fits the default grid size without pushing the
 * Power meter below the fold. A single-vessel-greenhouse widget, by far the
 * common case, costs exactly 2 lines (3 when the mod's own `issue` field is
 * also populated, e.g. once its "excessive radiation" report catches up to
 * this row's own `tooHigh` check).
 */
function GreenhouseEntryRow({
  g,
  titlePrefix,
  ambientRadiationRadPerSecond,
}: {
  g: GreenhouseRow;
  /** "Greenhouse" for the single-entry case, or the crop name when there are several. */
  titlePrefix: string;
  ambientRadiationRadPerSecond: number;
}) {
  const blocked = g.active && g.issue.length > 0;
  const tooHigh = radiationTooHigh(g, ambientRadiationRadPerSecond);
  return (
    <Section>
      <Cluster justify="between" gap="md">
        {/* Same head treatment as the host widget's own SectionHead (a
            muted uppercase Text), so the greenhouse rows read as part of
            one system rather than a second heading style. */}
        <Text tone="muted" size="xs">
          {titlePrefix.toUpperCase()}
        </Text>
        <Cluster gap="xs" justify="end" wrap>
          {tooHigh && (
            // `warning`, not `critical`: recoverable once the storm passes,
            // the same rung the host widget's Degraded status uses for it
            // (see this file's doc comments).
            <Badge
              role="status"
              aria-live="polite"
              severity="warning"
              size="sm"
            >
              Radiation too high
            </Badge>
          )}
          <Badge
            role="status"
            aria-live="polite"
            severity={greenhouseTone(g, tooHigh)}
            size="sm"
          >
            {greenhouseStateLabel(g, tooHigh)}
          </Badge>
        </Cluster>
      </Cluster>
      {/* Wraps rather than truncating at narrow widths, a hidden number is
          worse than an extra line. */}
      <Text tone="default" size="xs">
        Natural {fmtWm2(g.natural)} · Artificial {fmtWm2(g.artificial)} · Rate{" "}
        {fmtRatePerDay(g.foodRatePerSec)}
      </Text>
      {blocked && (
        // The bare "-fg" warning token is meant to sit ON the warning "-bg"
        // (e.g. inside a Badge); standalone on the panel's dark surface it
        // is near-black. "-fg-muted" is the standalone-warning-text token
        // (LaunchDirector, CommSignal, DeployedScience all use it).
        <Text
          tone="warn"
          size="xs"
          style={{ color: "var(--color-status-warning-fg-muted)" }}
        >
          {g.issue}
        </Text>
      )}
    </Section>
  );
}

function GreenhouseSection({
  greenhouses,
  ambientRadiationRadPerSecond,
}: LifeSupportSlotContext) {
  // No greenhouse part on the vessel, the common case. Render nothing
  // rather than an empty "Greenhouse" header with no content beneath it.
  if (greenhouses.length === 0) return null;
  // The overwhelmingly common case is exactly one greenhouse part: fold the
  // section identity straight into that one row's title ("Greenhouse")
  // instead of spending a whole extra line on a header no one needs. Only a
  // multi-greenhouse vessel (rare) gets a shared header, with each row then
  // titled by its own crop.
  if (greenhouses.length === 1) {
    return (
      <Stack gap="xs">
        <GreenhouseEntryRow
          g={greenhouses[0]}
          titlePrefix="Greenhouse"
          ambientRadiationRadPerSecond={ambientRadiationRadPerSecond}
        />
      </Stack>
    );
  }
  return (
    <Stack gap="xs">
      <Text tone="muted" size="xs">
        GREENHOUSES
      </Text>
      {greenhouses.map((g, i) => (
        <GreenhouseEntryRow
          // biome-ignore lint/suspicious/noArrayIndexKey: greenhouse parts carry no stable id on the wire yet
          key={`${g.cropResource}-${i}`}
          g={g}
          titlePrefix={g.cropResource}
          ambientRadiationRadPerSecond={ambientRadiationRadPerSecond}
        />
      ))}
    </Stack>
  );
}

registerAugment({
  id: "life-support-greenhouse",
  augments: "life-support.sections",
  component: GreenhouseSection,
  owner: KERBALISM,
});

export { GreenhouseSection, radiationTooHigh };
