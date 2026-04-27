import type { ComponentProps } from "@gonogo/core";
import { getBody, registerComponent, useDataValue } from "@gonogo/core";
import { Panel, PanelSubtitle, PanelTitle } from "@gonogo/ui";
import styled from "styled-components";

// Empty config — kept for forward-compat. Follow-ups: hide suicide-burn row
// on atmospheric landings; override body-atmosphere detection for mods.
type LandingStatusConfig = Record<string, never>;

/**
 * Telemachus Reborn returns (0, 0) for `land.predictedLat/Lon` when the
 * prediction is unavailable (no trajectory, already landed, etc.). It also
 * emits NaN for `land.timeToImpact` when no solution exists. Treat both as
 * "no prediction" at the widget layer.
 */
function isSentinel(lat: number | undefined, lon: number | undefined): boolean {
  return (lat === 0 && lon === 0) || lat === undefined || lon === undefined;
}

function notNumber(v: number | undefined): boolean {
  return v === undefined || !Number.isFinite(v);
}

function formatSeconds(s: number | undefined): string {
  if (s === undefined || !Number.isFinite(s) || s <= 0) return "—";
  if (s < 1) return `${s.toFixed(2)}s`;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const sec = Math.round(s - m * 60);
  return `${m}m ${sec}s`;
}

function formatMps(v: number | undefined): string {
  if (v === undefined || !Number.isFinite(v)) return "—";
  if (Math.abs(v) < 10) return `${v.toFixed(2)} m/s`;
  if (Math.abs(v) < 100) return `${v.toFixed(1)} m/s`;
  return `${v.toFixed(0)} m/s`;
}

function formatMeters(m: number | undefined): string {
  if (m === undefined || !Number.isFinite(m)) return "—";
  if (Math.abs(m) >= 10_000) return `${(m / 1000).toFixed(1)} km`;
  if (Math.abs(m) >= 1000) return `${(m / 1000).toFixed(2)} km`;
  return `${m.toFixed(0)} m`;
}

function formatDegrees(d: number | undefined): string {
  if (d === undefined || !Number.isFinite(d)) return "—";
  return `${d.toFixed(1)}°`;
}

function LandingStatusComponent(
  _: Readonly<ComponentProps<LandingStatusConfig>>,
) {
  const bodyName = useDataValue("data", "v.body");
  const body = bodyName ? getBody(bodyName) : undefined;
  const atmospheric = body?.hasAtmosphere ?? false;

  const timeToImpact = useDataValue("data", "land.timeToImpact");
  const impactSpeed = useDataValue("data", "land.speedAtImpact");
  const bestImpactSpeed = useDataValue("data", "land.bestSpeedAtImpact");
  const suicideBurn = useDataValue("data", "land.suicideBurnCountdown");
  const predictedLat = useDataValue("data", "land.predictedLat");
  const predictedLon = useDataValue("data", "land.predictedLon");
  const slope = useDataValue("data", "land.slopeAngle");

  const heightFromTerrain = useDataValue("data", "v.heightFromTerrain");
  const verticalSpeed = useDataValue("data", "v.verticalSpeed");

  // No trajectory solution at all — hide the full readout.
  const noPrediction =
    notNumber(timeToImpact) ||
    (isSentinel(predictedLat, predictedLon) && notNumber(impactSpeed));

  // Imminent suicide-burn: loud. The role="alert" fires when the countdown
  // is meaningful (finite) and drops under 5s, so the first render at ≥5s
  // doesn't shout.
  const urgent =
    suicideBurn !== undefined &&
    Number.isFinite(suicideBurn) &&
    suicideBurn > 0 &&
    suicideBurn <= 5;

  const descending = verticalSpeed !== undefined && verticalSpeed < 0;

  return (
    <Panel>
      <PanelTitle>LANDING</PanelTitle>
      {bodyName !== undefined && (
        <PanelSubtitle>
          {bodyName}
          {atmospheric ? " · atmospheric" : " · vacuum"}
        </PanelSubtitle>
      )}

      {noPrediction ? (
        <Empty>
          {descending
            ? "Waiting for a landing prediction…"
            : "No landing in progress"}
        </Empty>
      ) : (
        <>
          {/* Suicide burn — the headline on airless bodies. On atmospheric
              bodies KSP's prediction ignores aerobraking, so we still show it
              but demote it visually. */}
          <SuicideRow
            role={urgent ? "alert" : "status"}
            aria-live={urgent ? "assertive" : "polite"}
            $urgent={urgent}
            $muted={atmospheric}
          >
            <SuicideLabel>Suicide burn</SuicideLabel>
            <SuicideValue $urgent={urgent}>
              {suicideBurn === undefined || !Number.isFinite(suicideBurn)
                ? "—"
                : suicideBurn <= 0
                  ? "IGNITE"
                  : `T−${formatSeconds(suicideBurn)}`}
            </SuicideValue>
            {atmospheric && (
              <SuicideNote>
                atmospheric — ignores aerobraking, treat as upper bound
              </SuicideNote>
            )}
          </SuicideRow>

          <MetricGrid>
            <MetricLabel>Impact in</MetricLabel>
            <MetricValue>{formatSeconds(timeToImpact)}</MetricValue>

            <MetricLabel>Impact speed</MetricLabel>
            <MetricValue>
              {formatMps(impactSpeed)}
              {bestImpactSpeed !== undefined &&
                Number.isFinite(bestImpactSpeed) && (
                  <MetricSub> · best {formatMps(bestImpactSpeed)}</MetricSub>
                )}
            </MetricValue>

            <MetricLabel>Altitude</MetricLabel>
            <MetricValue>{formatMeters(heightFromTerrain)}</MetricValue>

            <MetricLabel>Descent</MetricLabel>
            <MetricValue>
              {verticalSpeed === undefined ? "—" : formatMps(verticalSpeed)}
            </MetricValue>

            <MetricLabel>Slope</MetricLabel>
            <MetricValue>{formatDegrees(slope)}</MetricValue>

            <MetricLabel>Predicted</MetricLabel>
            <MetricValue>
              {isSentinel(predictedLat, predictedLon)
                ? "—"
                : `${(predictedLat ?? 0).toFixed(3)}°, ${(predictedLon ?? 0).toFixed(3)}°`}
            </MetricValue>
          </MetricGrid>
        </>
      )}
    </Panel>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const Empty = styled.div`
  color: var(--color-text-faint);
  font-size: 11px;
  padding: 8px 0;
`;

const SuicideRow = styled.div<{ $urgent: boolean; $muted: boolean }>`
  margin-top: 8px;
  padding: ${({ $muted }) => ($muted ? "6px 10px" : "10px 12px")};
  background: ${({ $urgent, $muted }) =>
    $urgent
      ? "var(--color-status-alert-muted)"
      : $muted
        ? "var(--color-surface-panel)"
        : "var(--color-surface-raised)"};
  border: 1px solid
    ${({ $urgent, $muted }) =>
      $urgent
        ? "var(--color-status-nogo-bg)"
        : $muted
          ? "var(--color-border-subtle)"
          : "var(--color-border-subtle)"};
  border-radius: 2px;
  display: grid;
  grid-template-columns: auto 1fr;
  align-items: baseline;
  gap: 4px 12px;
  opacity: ${({ $muted, $urgent }) => ($muted && !$urgent ? 0.8 : 1)};
`;

const SuicideLabel = styled.span`
  font-size: var(--font-size-xs);
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--color-text-dim);
`;

const SuicideValue = styled.span<{ $urgent: boolean }>`
  font-size: 28px;
  font-weight: 700;
  color: ${({ $urgent }) => ($urgent ? "var(--color-status-nogo-fg)" : "var(--color-status-warning-bg)")};
  letter-spacing: 0.04em;
  justify-self: end;
  text-align: right;
`;

const SuicideNote = styled.span`
  grid-column: 1 / -1;
  font-size: var(--font-size-xs);
  color: var(--color-text-dim);
  letter-spacing: 0.03em;
`;

const MetricGrid = styled.div`
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 2px 10px;
  margin-top: 10px;
  align-items: baseline;
`;

const MetricLabel = styled.span`
  font-size: var(--font-size-xs);
  color: var(--color-text-faint);
  letter-spacing: 0.08em;
  text-transform: uppercase;
`;

const MetricValue = styled.span`
  font-size: 12px;
  color: var(--color-text-primary);
`;

const MetricSub = styled.span`
  color: var(--color-text-dim);
  font-size: var(--font-size-xs);
`;

// ── Registration ──────────────────────────────────────────────────────────────

registerComponent<LandingStatusConfig>({
  id: "landing-status",
  name: "Landing Status",
  description:
    "Suicide-burn countdown, impact time + speed, descent rate, predicted coordinates, and slope angle — focused on vacuum-body landings.",
  tags: ["telemetry", "landing"],
  defaultSize: { w: 8, h: 10 },
  component: LandingStatusComponent,
  dataRequirements: [
    "v.body",
    "v.heightFromTerrain",
    "v.verticalSpeed",
    "land.timeToImpact",
    "land.speedAtImpact",
    "land.bestSpeedAtImpact",
    "land.suicideBurnCountdown",
    "land.predictedLat",
    "land.predictedLon",
    "land.slopeAngle",
  ],
  defaultConfig: {},
  actions: [],
  pushable: true,
});

export { LandingStatusComponent };
