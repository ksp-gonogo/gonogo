// SCANsat per-scan-type coverage readout for MapView.
//
// Fills MapView's `map-view.sections` slot with the compact below-map
// coverage panel — moved out of core MapView (T8b,
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
// here) — this augment reads its own `scansat.coverage.<body>.<type>` and
// `scansat.scanningVessels` Topics directly via `useDataValue`/
// `useScanningVessels`.
//
// Presence-gated on `requires: "scansat"`: renders only while
// `scansat.available` is live, so an install without SCANsat never mounts
// it — zero impact on MapView for non-SCANsat users.

import type {} from "@ksp-gonogo/components"; // pulls MapView's "map-view.sections" SlotRegistry merge into this program (see that module's own declare-module comment)
import type { SlotProps } from "@ksp-gonogo/core";
import { registerAugment, useDataValue } from "@ksp-gonogo/core";
import { useMemo } from "react";
import styled from "styled-components";
import { useScanningVessels } from "../FogReveal/useScanLayers";
import type { SCANType } from "../schema";
import { SCAN_TYPE } from "../schema";

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
  const pct = useDataValue<number>(
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
        <Chip $variant="idle">—</Chip>
      )}
    </Row>
  );
}

const Panel = styled.div`
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding-top: 6px;
  margin-top: 6px;
  border-top: 1px solid var(--color-surface-raised);
`;

const Row = styled.div`
  display: grid;
  grid-template-columns: 48px 1fr 40px auto;
  align-items: center;
  gap: 6px;
`;

const Label = styled.span`
  font-size: 10px;
  letter-spacing: 0.12em;
  color: var(--color-text-faint);
  min-width: 28px;
  text-transform: uppercase;
`;

const Track = styled.div<{ $pct: number }>`
  height: 5px;
  border-radius: 3px;
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
  font-size: 14px;
  font-weight: 700;
  color: var(--color-text-primary);
  font-variant-numeric: tabular-nums;
  /* Numeric readout — never truncate digits. Shrink to fit the row instead
     of overflowing the panel edge at the 3-col minimum size. */
  min-width: 0;
  white-space: nowrap;
`;

const Chip = styled.span<{ $variant: "best" | "in" | "idle" }>`
  font-size: 9px;
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
});

export { CoveragePanel };
