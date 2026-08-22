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

import { registerAugment, useTelemetry, value } from "@ksp-gonogo/sitrep-sdk";
import { NULL_DISPLAY, Unit, useWidgetScope } from "@ksp-gonogo/ui-kit";
import type { CSSProperties } from "react";
import { useMemo } from "react";
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
function CoveragePanel() {
  const scanningVessels = useScanningVessels();
  // The mapped body comes from the host widget's published SCOPE, not from slot
  // props: `map-view.sections` is the framework's universal segment now, and a
  // universal segment carries no props.
  const bodyName = useWidgetScope("map-view")?.bodyName;

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
    // `<section>` for its implicit role="region" (a plain `<div role="region">`
    // trips biome's useSemanticElements; the styled.div this replaced hid the
    // intrinsic element from that rule).
    <section
      aria-label={`Scan coverage for ${bodyName}`}
      style={COVERAGE_COLUMN}
    >
      {COVERAGE_TYPES.map(({ type, label }) => (
        <CoverageRow
          key={type}
          bodyName={bodyName}
          scanType={type}
          label={label}
          range={rangeByType.get(type)}
        />
      ))}
    </section>
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
  const coverage = typeof pct === "number" ? pct : 0;
  const filled = Math.max(0, Math.min(100, coverage));
  return (
    <div style={COVERAGE_GRID}>
      <span style={LABEL}>{label}</span>
      {/* Track: a stadium rail with a filled sub-bar. The fill was a
          `::after` pseudo in styled-components; as an inline style it becomes
          a real child element instead (inline `style` can't express a
          pseudo). */}
      <div style={TRACK}>
        <div style={{ ...TRACK_FILL, width: `${filled}%` }} />
      </div>
      <span style={COVERAGE_VALUE}>
        {/* The wire carries 0..100, so the unit is `%` and not `ratio`:
            handing a percent to the ratio kind would multiply it again. */}
        <Unit value={value("%", coverage)} decimals={0} />
      </span>
      {range?.bestRange ? (
        <span style={{ ...CHIP, color: "var(--color-status-go-fg)" }}>
          best
        </span>
      ) : range?.inRange ? (
        <span style={{ ...CHIP, color: "var(--color-status-info-fg)" }}>
          scan
        </span>
      ) : (
        <span style={{ ...CHIP, color: "var(--color-text-faint)" }}>
          {NULL_DISPLAY}
        </span>
      )}
    </div>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────
// Structural inline styles (CSS-var tokens): this is a bespoke coverage grid,
// no reusable ui-kit primitive fits, so the layout stays local rather than
// carrying styled-components into a consumer widget.

const COVERAGE_COLUMN: CSSProperties = {
  flexShrink: 0,
  display: "flex",
  flexDirection: "column",
  // This 3px and CoverageGrid's 6px below are one decision, not two: the
  // vertical row gap is deliberately half the horizontal cell gap. Both stay
  // literal because the 3 -> 2 snap alone would turn that 2:1 into 3:1.
  gap: "3px",
  paddingTop: "var(--space-6)",
  marginTop: "var(--space-6)",
  borderTop: "1px solid var(--color-surface-raised)",
};

const COVERAGE_GRID: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "48px 1fr 40px auto",
  alignItems: "center",
  // Half of this is COVERAGE_COLUMN's row gap above; see the note there.
  gap: "6px",
};

const LABEL: CSSProperties = {
  fontSize: "var(--font-size-2xs)",
  letterSpacing: "0.12em",
  color: "var(--color-text-faint)",
  minWidth: "28px",
  textTransform: "uppercase",
};

// A stadium: 3px already exceeds half this 5px track, so --radius-pill is the
// shape it means and it keeps tracking the height. --radius-sm would render
// the same today and stop tracking it.
const TRACK: CSSProperties = {
  height: "5px",
  borderRadius: "var(--radius-pill)",
  background: "var(--color-surface-raised)",
  overflow: "hidden",
  position: "relative",
};

const TRACK_FILL: CSSProperties = {
  position: "absolute",
  inset: "0 auto 0 0",
  background: "var(--color-accent-fg)",
};

const COVERAGE_VALUE: CSSProperties = {
  // Literal: this sits in a fixed 40px grid column and must never truncate
  // (see below). --font-size-base is 15px under @media (pointer: coarse),
  // i.e. on the tier-1 Steam Deck, which is the wrong direction for a nowrap
  // readout in a fixed track.
  fontSize: "14px",
  fontWeight: 700,
  color: "var(--color-text-primary)",
  fontVariantNumeric: "tabular-nums",
  // Numeric readout: never truncate digits. Shrink to fit the row instead of
  // overflowing the panel edge at the 3-col minimum size.
  minWidth: 0,
  whiteSpace: "nowrap",
};

// Per-variant colour is applied inline at the call site (best/in/idle).
const CHIP: CSSProperties = {
  fontSize: "var(--font-size-2xs)",
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  textAlign: "right",
  minWidth: "4ch",
};

registerAugment({
  id: "scansat-coverage-panel",
  augments: "map-view.sections",
  requires: "scansat",
  component: CoveragePanel,
  owner: SCANSAT,
});

export { CoveragePanel };
