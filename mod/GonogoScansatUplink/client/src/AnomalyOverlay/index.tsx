// SCANsat anomaly overlay for MapView.
//
// Fills MapView's `map-view.overlay` slot with the on-map anomaly markers
// and the optional bearing/distance panel — moved out of core MapView
// (P4c-b: `scansat.anomalies.<body>` sign-off, see
// docs/superpowers/plans/2026-07-11-p4cb-deletion-plan.md §1) so core
// MapView no longer reads any SCANsat Topic directly (Uplink invariant #5,
// "augment, don't embed" — docs/superpowers/plans/2026-07-10-uplink-
// autonomous-push-goal.md).
//
// `map-view.overlay` is an OVERLAY slot (not a section/badge slot): MapView
// passes down the live equirectangular projection (`project`) plus its own
// `showAnomalies`/`showAnomalyPanel` config toggles and the vessel's raw
// (unadjusted) lat/lon, so this augment can place markers on the exact same
// pixels the base map paints without re-deriving the body-offset/camera
// maths, and rank anomalies by distance without MapView ever touching
// `scansat.anomalies` itself.
//
// Presence-gated on `requires: "scansat"`: renders only while
// `scansat.available` is live, so an install without SCANsat never mounts
// it — zero impact on MapView for non-SCANsat users.

import type {} from "@ksp-gonogo/components"; // pulls MapView's "map-view.overlay" SlotRegistry merge into this program (see that module's own declare-module comment)
import type { SlotProps } from "@ksp-gonogo/core";
import { registerAugment } from "@ksp-gonogo/core";
import { useScanAnomalies } from "@ksp-gonogo/data";
import { useMemo } from "react";
import styled from "styled-components";
import { compassPoint, rankAnomaliesByDistance } from "./geometry";

/** Fallback body radius (metres) for distance ranking when `bodyRadius` is unknown — Kerbin's, the common case. */
const DEFAULT_BODY_RADIUS = 600_000;

function AnomalyOverlay(ctx: SlotProps<"map-view.overlay">) {
  const wantAnomalies = ctx.showAnomalies || ctx.showAnomalyPanel;
  const anomalies = useScanAnomalies(wantAnomalies ? ctx.bodyName : undefined);

  // Discovered-only markers — undiscovered anomalies don't appear at all
  // (the player can't see what they haven't found), matching the old
  // core-MapView canvas draw's gating.
  const known = useMemo(
    () => (Array.isArray(anomalies) ? anomalies.filter((a) => a.known) : []),
    [anomalies],
  );

  const ranked = useMemo(() => {
    if (!ctx.showAnomalyPanel || !Array.isArray(anomalies)) return [];
    return rankAnomaliesByDistance(
      anomalies,
      ctx.vesselLat,
      ctx.vesselLon,
      ctx.bodyRadius ?? DEFAULT_BODY_RADIUS,
    );
  }, [
    ctx.showAnomalyPanel,
    anomalies,
    ctx.vesselLat,
    ctx.vesselLon,
    ctx.bodyRadius,
  ]);

  if (!wantAnomalies) return null;

  return (
    <>
      {ctx.showAnomalies &&
        known.map((a) => {
          const { x, y } = ctx.project(a.latitude, a.longitude);
          return (
            <Marker
              key={`${a.name}-${a.latitude}-${a.longitude}`}
              style={{ left: x, top: y }}
              $detail={a.detail}
              aria-hidden="true"
            />
          );
        })}
      {ctx.showAnomalyPanel && ranked.length > 0 && (
        <Panel
          role="region"
          aria-label={`Anomalies near ${ctx.bodyName ?? "body"}`}
        >
          <PanelTitle>Anomalies</PanelTitle>
          <List>
            {ranked.map(({ anomaly, distanceMetres, bearingDeg }) => (
              <Item key={`${anomaly.name}-${anomaly.latitude}`}>
                <Name>{anomaly.detail ? anomaly.name : "(unknown)"}</Name>
                {Number.isFinite(distanceMetres) ? (
                  <>
                    <Dist>
                      {distanceMetres >= 1000
                        ? `${(distanceMetres / 1000).toFixed(0)} km`
                        : `${distanceMetres.toFixed(0)} m`}
                    </Dist>
                    <Bearing>
                      {compassPoint(bearingDeg)} {bearingDeg.toFixed(0)}°
                    </Bearing>
                  </>
                ) : (
                  <Dist>
                    {anomaly.latitude.toFixed(1)},{" "}
                    {anomaly.longitude.toFixed(1)}
                  </Dist>
                )}
              </Item>
            ))}
          </List>
        </Panel>
      )}
    </>
  );
}

// Fixed screen-pixel size (unlike the old canvas draw's inverse-zoom-scaled
// radius) — `project()` already hands back post-camera-transform screen
// pixels, so a constant CSS size reads consistently at any zoom without
// re-deriving the camera's zoom factor here.
const Marker = styled.div<{ $detail: boolean }>`
  position: absolute;
  width: 8px;
  height: 8px;
  margin: -4px 0 0 -4px;
  border-radius: 50%;
  background: ${(p) =>
    p.$detail ? "rgba(255, 220, 90, 0.95)" : "rgba(255, 220, 90, 0.55)"};
  border: 1.5px solid
    ${(p) =>
      p.$detail ? "rgba(255, 255, 200, 0.95)" : "rgba(255, 255, 200, 0.4)"};
  pointer-events: none;
`;

// The `map-view.overlay` layer itself is `pointer-events: none` (see
// @ksp-gonogo/components's OverlayAugmentLayer) so it stays inert when
// empty; this panel opts back in for its own scrollable list.
const Panel = styled.aside`
  position: absolute;
  top: 8px;
  right: 8px;
  max-width: 40%;
  max-height: calc(100% - 16px);
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px;
  overflow-y: auto;
  pointer-events: auto;
  background: var(--color-surface-raised);
  border: 1px solid var(--color-border-subtle);
  border-radius: 3px;
`;

const PanelTitle = styled.h3`
  font-size: 10px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--color-text-muted);
  margin: 0;
`;

const List = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
`;

const Item = styled.li`
  display: grid;
  grid-template-columns: 1fr auto;
  grid-template-areas:
    "name dist"
    "name bearing";
  align-items: baseline;
  column-gap: 6px;
  padding: 3px 6px;
  background: var(--color-surface-sunken);
  border: 1px solid var(--color-border-subtle);
  border-radius: 3px;
`;

const Name = styled.span`
  grid-area: name;
  font-size: var(--font-size-xs);
  color: var(--color-text-primary);
  align-self: center;
`;

const Dist = styled.span`
  grid-area: dist;
  font-size: var(--font-size-xs);
  font-weight: 600;
  color: var(--color-text-primary);
  font-variant-numeric: tabular-nums;
  text-align: right;
`;

const Bearing = styled.span`
  grid-area: bearing;
  font-size: 10px;
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
  text-align: right;
`;

registerAugment({
  id: "scansat-anomaly-overlay",
  augments: "map-view.overlay",
  requires: "scansat",
  component: AnomalyOverlay,
});

export { AnomalyOverlay };
