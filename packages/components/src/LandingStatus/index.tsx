import type { ComponentProps } from "@gonogo/core";
import { getBody, registerComponent, useDataValue } from "@gonogo/core";
import { EmptyState, Panel, PanelSubtitle, PanelTitle } from "@gonogo/ui";
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

/** Kelvin → Celsius, for readability on the LandingStatus readout. */
function formatTempC(k: number | undefined): string {
  if (k === undefined || !Number.isFinite(k)) return "—";
  const c = k - 273.15;
  return `${c.toFixed(0)} °C`;
}

/**
 * Atmospheric density in kg/m³. Stock Kerbin sea level is ~1.225 kg/m³; the
 * mesosphere thins to single-digit grams; high-altitude values drop into
 * 1e-6 territory. Pick a representation per magnitude so the readout stays
 * comparable across an entire descent.
 */
function formatDensity(d: number | undefined): string {
  if (d === undefined || !Number.isFinite(d)) return "—";
  const abs = Math.abs(d);
  if (abs >= 1) return `${d.toFixed(3)} kg/m³`;
  if (abs >= 1e-3) return `${(d * 1000).toFixed(2)} g/m³`;
  return `${d.toExponential(2)} kg/m³`;
}

function LandingStatusComponent({
  w,
  h,
}: Readonly<ComponentProps<LandingStatusConfig>>) {
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

  const atmDensity = useDataValue("data", "v.atmosphericDensity");
  const atmTemperature = useDataValue("data", "v.atmosphericTemperature");
  const externalTemperature = useDataValue("data", "v.externalTemperature");

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

  // Selective rendering — countdown is always the headline; metric rows
  // drop from the bottom (slope/predicted first) as height shrinks.
  const cols = w ?? 8;
  const rows = h ?? 10;
  const showSubtitle = rows >= 6;
  const showAtmosphericNote = rows >= 7;
  const showImpactRows = rows >= 6;
  const showAltitudeRows = rows >= 8;
  const showSlopeRows = rows >= 10;
  const showAnyMetricGrid = showImpactRows || showAltitudeRows || showSlopeRows;
  const showBestImpactInline = cols >= 8;
  // Ambient section is only ever useful on atmospheric bodies — it tells the
  // operator how thick the air is and how hot the skin is during a reentry
  // burn. On vacuum landings the values are all ~0/ambient and add noise.
  const showAmbient = atmospheric && rows >= 9;

  return (
    <Panel>
      <PanelTitle>LANDING</PanelTitle>
      {showSubtitle && bodyName !== undefined && (
        <PanelSubtitle>
          {bodyName}
          {atmospheric ? " · atmospheric" : " · vacuum"}
        </PanelSubtitle>
      )}

      {noPrediction ? (
        <EmptyState>
          {descending
            ? "Waiting for a landing prediction…"
            : "No landing in progress"}
        </EmptyState>
      ) : (
        <Body>
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
            {atmospheric && showAtmosphericNote && (
              <SuicideNote>
                atmospheric — ignores aerobraking, treat as upper bound
              </SuicideNote>
            )}
          </SuicideRow>

          {showAnyMetricGrid && (
            <MetricGrid>
              {showImpactRows && (
                <>
                  <MetricLabel>Impact in</MetricLabel>
                  <MetricValue>{formatSeconds(timeToImpact)}</MetricValue>

                  <MetricLabel>Impact speed</MetricLabel>
                  <MetricValue>
                    {formatMps(impactSpeed)}
                    {showBestImpactInline &&
                      bestImpactSpeed !== undefined &&
                      Number.isFinite(bestImpactSpeed) && (
                        <MetricSub>
                          {" "}
                          · best {formatMps(bestImpactSpeed)}
                        </MetricSub>
                      )}
                  </MetricValue>
                </>
              )}

              {showAltitudeRows && (
                <>
                  <MetricLabel>Altitude</MetricLabel>
                  <MetricValue>{formatMeters(heightFromTerrain)}</MetricValue>

                  <MetricLabel>Descent</MetricLabel>
                  <MetricValue>
                    {verticalSpeed === undefined
                      ? "—"
                      : formatMps(verticalSpeed)}
                  </MetricValue>
                </>
              )}

              {showSlopeRows && (
                <>
                  <MetricLabel>Slope</MetricLabel>
                  <MetricValue>{formatDegrees(slope)}</MetricValue>

                  <MetricLabel>Predicted</MetricLabel>
                  <MetricValue>
                    {isSentinel(predictedLat, predictedLon)
                      ? "—"
                      : `${(predictedLat ?? 0).toFixed(3)}°, ${(predictedLon ?? 0).toFixed(3)}°`}
                  </MetricValue>
                </>
              )}
            </MetricGrid>
          )}

          {showAmbient && (
            <MetricGrid>
              <MetricLabel>Air density</MetricLabel>
              <MetricValue>{formatDensity(atmDensity)}</MetricValue>

              <MetricLabel>Air temp</MetricLabel>
              <MetricValue>{formatTempC(atmTemperature)}</MetricValue>

              <MetricLabel>Skin temp</MetricLabel>
              <MetricValue>{formatTempC(externalTemperature)}</MetricValue>
            </MetricGrid>
          )}
        </Body>
      )}
    </Panel>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const Body = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
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
  minSize: { w: 4, h: 5 },
  component: LandingStatusComponent,
  dataRequirements: [
    "v.body",
    "v.heightFromTerrain",
    "v.verticalSpeed",
    "v.atmosphericDensity",
    "v.atmosphericTemperature",
    "v.externalTemperature",
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
  requires: ["flight"],
});

export { LandingStatusComponent };
