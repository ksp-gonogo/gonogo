// RealFuels' contribution to the base Fuel & ΔV widget.
//
// It takes the framework's universal `fuel-status.sections` seat, which
// FuelStatus places itself (beneath the per-stage ΔV/TWR stack) rather than
// leaving to `Panel`'s end-of-body default. So the two facts that decide whether
// a burn happens sit directly under the budget that assumes it will: an operator
// reading 1,400 m/s of stage ΔV can see in the same tile whether the engine can
// be lit to spend it.
//
// Presence-gated on `realfuels.available` via `requires: "realfuels"`, and
// data-gated besides: with no engine reading the section draws nothing at all
// and FuelStatus composes exactly as it does on a stock install.

import { registerAugment, useTelemetry } from "@ksp-gonogo/sitrep-sdk";
import {
  Badge,
  Grid,
  NULL_DISPLAY,
  ReadoutCaption,
  type Severity,
  Stack,
  Text,
  Unit,
} from "@ksp-gonogo/ui-kit";
import type {
  RealFuelsBoiloff,
  RealFuelsEngineEntry,
} from "../__generated__/contract";
import { REALFUELS } from "../uplink";
// Side-effect import: the Topic registrations and the unit/shape hydration this
// section's readings depend on. Pulled here rather than left to the package
// entry point's import order, since this is their one consumer.
import "../topics";

/**
 * RealFuels' own settling bands, from its ullage simulator's state strings.
 * They are thresholds rather than a gradient, and an operator decides on the
 * band rather than on the number, so the band is what carries the colour.
 */
const STABILITY_BANDS: readonly {
  floor: number;
  label: string;
  severity: Severity;
}[] = [
  { floor: 0.996, label: "SETTLED", severity: "nominal" },
  { floor: 0.95, label: "STABLE", severity: "nominal" },
  { floor: 0.75, label: "RISKY", severity: "caution" },
  { floor: 0.3, label: "VERY RISKY", severity: "warning" },
  { floor: 0.15, label: "UNSTABLE", severity: "critical" },
];

/** The bottom of RealFuels' cascade, which has no floor to clear. */
const VERY_UNSTABLE = {
  label: "VERY UNSTABLE",
  severity: "critical" as Severity,
};

function bandFor(stability: number) {
  // The first floor a reading clears, which is what RealFuels' own cascade does.
  return STABILITY_BANDS.find((b) => stability >= b.floor) ?? VERY_UNSTABLE;
}

/**
 * The ignition budget as words, because the number alone cannot be read: the
 * same value is a real count, an unlimited sentinel or a pad-only restriction
 * depending on two flags the Uplink derives (see RealFuelsEngineEntry).
 *
 * An engine with no reading gets a dash, never a zero. Under RealFuels a zero is
 * the claim that the engine will not light off the pad at all, which is the one
 * thing an operator must not be told by accident.
 */
function IgnitionState({ engine }: { engine: RealFuelsEngineEntry }) {
  if (engine.ignitionsUnlimited === true) {
    return (
      <Badge severity="nominal" size="sm">
        UNLIMITED
      </Badge>
    );
  }
  if (engine.groundIgnitionOnly === true) {
    return (
      <Badge severity="warning" size="sm">
        GROUND ONLY
      </Badge>
    );
  }
  // A count is only readable once the regime around it is known. `false` here is
  // a positive statement that the budget is a real one; null means the Uplink
  // could not read the game-wide switch, and a count drawn under an unknown
  // regime is the failure this whole derivation exists to prevent.
  if (
    engine.groundIgnitionOnly !== false ||
    engine.ignitionsRemaining == null
  ) {
    return (
      <Text size="xs" tone="muted">
        {NULL_DISPLAY}
      </Text>
    );
  }
  return (
    <Badge
      severity={engine.ignitionsRemaining.magnitude > 1 ? "nominal" : "caution"}
      size="sm"
    >
      <Unit value={engine.ignitionsRemaining} decimals={0} /> LEFT
    </Badge>
  );
}

/**
 * Settling for one engine. An engine RealFuels does not model ullage for has no
 * settling to report and says so, which is a different answer from settled
 * propellant and must not render as one.
 */
function UllageState({
  engine,
  simulated,
}: {
  engine: RealFuelsEngineEntry;
  simulated: boolean | undefined;
}) {
  if (simulated === false) {
    return (
      <Text size="xs" tone="muted">
        not simulated
      </Text>
    );
  }
  if (engine.ullageModelled === false) {
    return (
      <Text size="xs" tone="muted">
        not subject
      </Text>
    );
  }
  if (engine.ullageStability == null) {
    return (
      <Text size="xs" tone="muted">
        {NULL_DISPLAY}
      </Text>
    );
  }
  const band = bandFor(engine.ullageStability.magnitude);
  return (
    <Badge severity={band.severity} size="sm">
      {band.label}
      {engine.ignitionProbability != null && (
        <>
          {" "}
          <Unit value={engine.ignitionProbability} decimals={0} />
        </>
      )}
    </Badge>
  );
}

function EngineRow({
  engine,
  simulated,
}: {
  engine: RealFuelsEngineEntry;
  simulated: boolean | undefined;
}) {
  return (
    <>
      <Text size="xs" tone="muted">
        {engine.partName ?? NULL_DISPLAY}
      </Text>
      <IgnitionState engine={engine} />
      <UllageState engine={engine} simulated={simulated} />
    </>
  );
}

/**
 * Cryogenic loss, as a rate. Absent when the vessel carries no cryogenic tanks
 * (a hypergolic stack never boils off, which is worth saying) and absent again
 * when there are tanks but no measurement, which is a different thing and reads
 * as a dash rather than as nothing lost.
 */
function BoiloffRow({ boiloff }: { boiloff: RealFuelsBoiloff }) {
  const tanks = boiloff.cryogenicTankCount?.magnitude;
  if (tanks === 0) return null;
  return (
    <>
      <Text size="xs" tone="muted">
        Boiloff
      </Text>
      <Text size="sm">
        {boiloff.boiloffRate == null ? (
          NULL_DISPLAY
        ) : (
          <Unit value={boiloff.boiloffRate} decimals={2} />
        )}
      </Text>
      <Text size="xs" tone="muted">
        {tanks == null
          ? NULL_DISPLAY
          : `${tanks} cryo tank${tanks === 1 ? "" : "s"}`}
      </Text>
    </>
  );
}

/**
 * The section itself: one row per RealFuels engine, then the vessel's boiloff.
 *
 * Draws nothing at all when RealFuels has reported no engines. A heading over an
 * empty grid would claim the Uplink had looked and found a vessel with no
 * engines, which is not what an absent reading says.
 */
export function EngineRealismSection() {
  // Only a current observation is drawn. An ignition budget held from before a
  // gap is the worst kind of number to draw, because the burn it describes may
  // already have spent it.
  const engineReading = useTelemetry("realfuels.engines");
  const boiloffReading = useTelemetry("realfuels.boiloff");
  const engines =
    engineReading.state === "observed" ? engineReading.value : undefined;
  const boiloff =
    boiloffReading.state === "observed" ? boiloffReading.value : undefined;

  const rows = engines?.engines;
  if (rows == null || rows.length === 0) return null;

  return (
    <Stack gap="xs">
      <ReadoutCaption>Ignition & ullage</ReadoutCaption>
      <Grid cols="minmax(0, 1fr) auto auto" gap="sm" align="baseline">
        {rows.map((engine, index) => (
          <EngineRow
            // The part id is the identity; the index is only reached for a row
            // whose id could not be read, which is exactly a row that has no
            // other identity to key on.
            key={engine.partId?.toString() ?? `engine-${index}`}
            engine={engine}
            simulated={engines?.ullageSimulated}
          />
        ))}
        {boiloff != null && <BoiloffRow boiloff={boiloff} />}
      </Grid>
    </Stack>
  );
}

registerAugment({
  id: "realfuels-fuel-status-section",
  augments: "fuel-status.sections",
  requires: "realfuels",
  channels: ["realfuels.engines", "realfuels.boiloff"],
  component: EngineRealismSection,
  owner: REALFUELS,
});
