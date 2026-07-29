// SCANsat per-scan-type coverage readout for MapView.
//
// Fills MapView's `map-view.sections` slot with the compact below-map
// coverage panel: moved out of core MapView (T8b,
// docs/superpowers/plans/2026-07-18-mapview-overlay-host-foundation.md) so
// core MapView no longer reads `scansat.coverage.<body>.<type>` or
// `scansat.scanningVessels` itself (Uplink invariant #5, "augment, don't
// embed"). This is a direct port of the old MapView-internal
// `CoveragePanelView`/`CoverageRow`/`COVERAGE_TYPES`
// (packages/components/src/MapView/index.tsx) sourced from this Uplink's
// own scan schema (`../schema`) instead of the shared core copy.
//
// `map-view.sections` is a below-content panel slot: MapView passes down
// only the mapped body name (plus per-namespace augment settings, unused
// here): this augment reads its own `scansat.coverage.<body>.<type>` and
// `scansat.scanningVessels` Topics directly via `useDataValue`/
// `useScanningVessels`.
//
// Presence-gated on `requires: "scansat"`: renders only while
// `scansat.available` is live, so an install without SCANsat never mounts
// it: zero impact on MapView for non-SCANsat users.

import type { SlotProps } from "@ksp-gonogo/sitrep-sdk";
import { registerAugment, useTelemetry } from "@ksp-gonogo/sitrep-sdk";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import { useMemo } from "react";
import styled from "styled-components";
import { useScanningVessels } from "../FogReveal/useScanLayers";
import type { SCANType } from "../schema";
import { SCAN_TYPE } from "../schema";
import { SCANSAT } from "../uplink";

const COVERAGE_TYPES: { type: SCANType; label: string }[] = [
  { type: SCAN_TYPE.AltimetryHiRes, label: "Alt Hi" },
  { type: SCAN_TYPE.AltimetryLoRes, label: "Alt Lo" },
  { type: SCAN_TYPE.Biome, label: "Biome" },
  { type: SCAN_TYPE.ResourceHiRes, label: "Res Hi" },
  { type: SCAN_TYPE.ResourceLoRes, label: "Res Lo" },
];

/**
 * Compact per-scan-type coverage readout for the mapped body, plus a
 * summary of which scan types currently have an in-range / best-range
 * scanner. Driven entirely by `scansat.coverage.<body>.<type>` and the
 * sensors on `scansat.scanningVessels` for this body.
 */
function CoveragePanel(ctx: SlotProps<"map-view.sections">) {
  const scanningVessels = useScanningVessels();
  const bodyName = ctx.bodyName;

  // Aggregate per-type range state across every scanning vessel on this
  // body: a type is "best" if any sensor is bestRange, "scanning" if any
  // is inRange. Vessels on other bodies are excluded.
  const rangeByType = useMemo(() => {
    const map = new Map<number, { inRange: boolean; bestRange: boolean }>();
    if (!bodyName || !Array.isArray(scanningVessels)) return map;
    for (const v of scanningVessels) {
      if (v.body !== bodyName) continue;
      for (const s of v.sensors) {
        const cur = map.get(s.type) ?? { inRange: false, bestRange: false };
        map.set(s.type, {
          inRange: cur.inRange || s.inRange,
          bestRange: cur.bestRange || s.bestRange,
        });
      }
    }
    return map;
  }, [scanningVessels, bodyName]);

  if (!bodyName) return null;

  return (
    <Panel role="region" aria-label={`Scan coverage for ${bodyName}`}>
      {COVERAGE_TYPES.map(({ type, label }) => (
        <CoverageRow
          key={type}
          bodyName={bodyName}
          scanType={type}
          label={label}
          range={rangeByType.get(type)}
        />
      ))}
    </Panel>
  );
}

function CoverageRow({
  bodyName,
  scanType,
  label,
  range,
}: Readonly<{
  bodyName: string;
  scanType: SCANType;
  label: string;
  range: { inRange: boolean; bestRange: boolean } | undefined;
}>) {
  const pct = useTelemetry<number>(
    "data",
    `scansat.coverage.${bodyName}.${scanType}`,
  );
  const value = typeof pct === "number" ? pct : 0;
  return (
    <Row>
      <Label>{label}</Label>
      <Track $pct={value} />
      <Value>{value.toFixed(0)}%</Value>
      {range?.bestRange ? (
        <Chip $variant="best">best</Chip>
      ) : range?.inRange ? (
        <Chip $variant="in">scan</Chip>
      ) : (
        <Chip $variant="idle">{NULL_DISPLAY}</Chip>
      )}
    </Row>
  );
}

const Panel = styled.div`
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  /* This 3px and Row's 6px below are one decision, not two: the vertical row
     gap is deliberately half the horizontal cell gap. Both stay literal
     because the 3 -> 2 snap alone would turn that 2:1 into 3:1. */
  gap: 3px;
  padding-top: var(--space-6);
  margin-top: var(--space-6);
  border-top: 1px solid var(--color-surface-raised);
`;

const Row = styled.div`
  display: grid;
  grid-template-columns: 48px 1fr 40px auto;
  align-items: center;
  /* Half of this is Panel's row gap above; see the note there. */
  gap: 6px;
`;

const Label = styled.span`
  font-size: var(--font-size-2xs);
  letter-spacing: 0.12em;
  color: var(--color-text-faint);
  min-width: 28px;
  text-transform: uppercase;
`;

const Track = styled.div<{ $pct: number }>`
  height: 5px;
  /* A stadium: 3px already exceeds half this 5px track, so --radius-pill is
     the shape it means and it keeps tracking the height. --radius-sm would
     render the same today and stop tracking it. */
  border-radius: var(--radius-pill);
  background: var(--color-surface-raised);
  overflow: hidden;
  position: relative;

  &::after {
    content: "";
    position: absolute;
    inset: 0 auto 0 0;
    width: ${({ $pct }) => `${Math.max(0, Math.min(100, $pct))}%`};
    background: var(--color-accent-fg);
  }
`;

const Value = styled.span`
  /* Literal: this sits in a fixed 40px grid column and must never truncate
     (see below). --font-size-base is 15px under @media (pointer: coarse),
     i.e. on the tier-1 Steam Deck, which is the wrong direction for a
     nowrap readout in a fixed track. */
  font-size: 14px;
  font-weight: 700;
  color: var(--color-text-primary);
  font-variant-numeric: tabular-nums;
  /* Numeric readout: never truncate digits. Shrink to fit the row instead
     of overflowing the panel edge at the 3-col minimum size. */
  min-width: 0;
  white-space: nowrap;
`;

const Chip = styled.span<{ $variant: "best" | "in" | "idle" }>`
  font-size: var(--font-size-2xs);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  text-align: right;
  min-width: 4ch;
  color: ${({ $variant }) =>
    $variant === "best"
      ? "var(--color-status-go-fg)"
      : $variant === "in"
        ? "var(--color-status-info-fg)"
        : "var(--color-text-faint)"};
`;

registerAugment({
  id: "scansat-coverage-panel",
  augments: "map-view.sections",
  requires: "scansat",
  component: CoveragePanel,
  owner: SCANSAT,
});

export { CoveragePanel };
