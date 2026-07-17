import type { ComponentProps } from "@ksp-gonogo/core";
import {
  AugmentSlot,
  getBody,
  getWidgetShape,
  kelvinToCelsius,
  registerComponent,
  useDataStreamStatus,
  useTelemetry,
} from "@ksp-gonogo/core";
import { useStream, type VesselState } from "@ksp-gonogo/sitrep-client";
import {
  EmptyState,
  Panel,
  PanelSubtitle,
  PanelTitle,
  ScrollArea,
  StreamStatusBadge,
} from "@ksp-gonogo/ui";
import { Badge, formatDuration } from "@ksp-gonogo/ui-kit";
import styled from "styled-components";
import { formatDensity } from "../shared/formatDensity";

// Empty config — kept for forward-compat. Follow-ups: hide suicide-burn row
// on atmospheric landings; override body-atmosphere detection for mods.
type LandingStatusConfig = Record<string, never>;

/**
 * Props for `landing-status.badges` — the widget's BROAD escape-hatch slot,
 * rendered in the header row next to the title.
 * A cheap integration seam for small inline status chips an Uplink wants beside
 * the "LANDING" title (e.g. a landing-guidance quality chip). Badge augments
 * read their own Topics via hooks, so only labelling context is passed down.
 */
export interface LandingStatusBadgesContext {
  /** Body being landed on (`v.body`), when known. */
  bodyName: string | null;
  /** Whether that body has an atmosphere (drives the vacuum/atmospheric split). */
  atmospheric: boolean;
}

// Co-located declaration-merge of this widget's slot id → its props.
// Kept next to the widget (not in a central registry file) so parallel slot
// work on other widgets never collides on this seam.
declare module "@ksp-gonogo/core" {
  interface SlotRegistry {
    "landing-status.badges": LandingStatusBadgesContext;
  }
}

/**
 * Two "no prediction" shapes to fold together at the widget layer: the
 * legacy Telemachus Reborn `(0, 0)` sentinel (kept for a recording captured
 * against that fallback, or a legacy DataSource still answering this key)
 * and the stream-derived `null`/`null` (`vessel.state.landingPredicted{Lat,
 * Lon}` — a genuine, honest "no impact found within the bounded horizon",
 * never a fabricated `(0, 0)`; see `orbit-patches.ts`'s `findImpactPoint`).
 * `land.timeToImpact` separately emits NaN/`null` when no solution exists —
 * `notNumber` below handles that half.
 */
function isSentinel(
  lat: number | null | undefined,
  lon: number | null | undefined,
): boolean {
  return (
    (lat === 0 && lon === 0) ||
    lat === undefined ||
    lon === undefined ||
    lat === null ||
    lon === null
  );
}

function notNumber(v: number | undefined): boolean {
  return v === undefined || !Number.isFinite(v);
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

/** Kelvin → Celsius, for readability on the LandingStatus readout. */
function formatTempC(k: number | undefined): string {
  if (k === undefined || !Number.isFinite(k)) return "—";
  const c = kelvinToCelsius(k);
  return `${c.toFixed(0)} °C`;
}

function LandingStatusComponent({
  w,
  h,
}: Readonly<ComponentProps<LandingStatusConfig>>) {
  const bodyName = useStream<VesselState>("vessel.state")?.parentBodyName;
  const body = bodyName ? getBody(bodyName) : undefined;
  const atmospheric = body?.hasAtmosphere ?? false;

  const timeToImpact =
    useStream<VesselState>("vessel.state")?.landingTimeToImpact ?? undefined;
  const impactSpeed =
    useStream<VesselState>("vessel.state")?.landingSpeedAtImpact ?? undefined;
  const bestImpactSpeed =
    useStream<VesselState>("vessel.state")?.landingBestSpeedAtImpact ??
    undefined;
  const suicideBurn =
    useStream<VesselState>("vessel.state")?.landingSuicideBurnCountdown ??
    undefined;
  const predictedLat =
    useStream<VesselState>("vessel.state")?.landingPredictedLat ?? undefined;
  const predictedLon =
    useStream<VesselState>("vessel.state")?.landingPredictedLon ?? undefined;

  // Two DIFFERENT altitude readings, and the distinction matters on a
  // landing: `vessel.flight.altitudeTerrain` is KSP's `radarAltitude`,
  // measured from the vessel's CENTRE OF MASS, while
  // `vessel.surface.heightFromTerrain` accounts for the vessel's physical
  // extent — "how far is my LOWEST point from the ground", which is the
  // number that decides when the gear touches and when the burn must end.
  // Prefer the lowest-point reading; fall back to the CoM one when
  // `vessel.surface` is absent (the capture side nulls the whole channel
  // while Orbiting/Escaping rather than serve a stale deep-space AGL —
  // see VesselSurface's contract doc). A deorbiting craft is SubOrbital by
  // the time the burn matters, so the fallback is the far-from-terrain case.
  const altitudeTerrain = useTelemetry("vessel.flight")?.altitudeTerrain;
  const surfaceHeight = useTelemetry("vessel.surface")?.heightFromTerrain;
  const heightFromTerrain = surfaceHeight ?? altitudeTerrain;
  const verticalSpeed = useTelemetry("vessel.flight")?.verticalSpeed;

  const atmDensity = useTelemetry("vessel.flight")?.atmDensity;
  const atmTemperature = useTelemetry("vessel.flight")?.atmosphericTemperature;
  const externalTemperature =
    useTelemetry("vessel.flight")?.externalTemperature;

  // Connectivity indicator, mirroring the TitleRow pattern used elsewhere.
  // `v.heightFromTerrain` is this widget's representative MAPPED
  // key (-> raw `vessel.flight.altitudeTerrain`); `v.verticalSpeed` (->
  // `vessel.flight.verticalSpeed`) and `v.atmosphericDensity` (->
  // `vessel.flight.atmDensity`) are also mapped. Every `land.*` key is now
  // mapped — the four ballistic scalars onto `vessel.state.landing*`
  // (`deriveLanding`) and predictedLat/Lon onto the same channel's
  // client patch-walk (`findImpactPoint`). `v.body`/
  // `v.atmosphericTemperature`/`v.externalTemperature` stay GAPPED/legacy.
  // See `stream.test.tsx` for the full readout streaming end to end.
  const streamStatus = useDataStreamStatus("data", "v.heightFromTerrain");

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
  // drop from the bottom (predicted first) as height shrinks.
  const cols = w ?? 8;
  const rows = h ?? 10;
  // Wide-short: lay the headline + metric grid side-by-side so the metrics
  // show despite the short height (width compensates for the row-gates).
  const isLandscape = getWidgetShape(w, h).shape === "landscape";
  const showSubtitle = rows >= 6;
  const showAtmosphericNote = rows >= 7;
  const showImpactRows = rows >= 6 || isLandscape;
  const showAltitudeRows = rows >= 8 || isLandscape;
  // Predicted stays height-gated — a third metric pair would overflow the
  // short landscape height beside the headline.
  const showPredictedRow = rows >= 10;
  const showAnyMetricGrid =
    showImpactRows || showAltitudeRows || showPredictedRow;
  const showBestImpactInline = cols >= 8;
  // Ambient section is only ever useful on atmospheric bodies — it tells the
  // operator how thick the air is and how hot the skin is during a reentry
  // burn. On vacuum landings the values are all ~0/ambient and add noise.
  const showAmbient = atmospheric && rows >= 9;
  // At narrow widths the SuicideRow's label + headline value won't fit
  // side-by-side (label "SUICIDE BURN" alone takes ~95px before adding
  // the value). Stack vertically — label on top, value on its own line —
  // so the value can use the full inner width. cols 4 (minSize) and
  // cols 6 are the reachable narrow widths and both trigger stacking.
  const stackSuicide = cols < 8;
  // The countdown is the headline, but "T−40.0s" at 28px overflows the
  // inner width at narrow column counts even when stacked (the grid track
  // is shrink-resistant — see minmax(0,1fr) below — but the glyphs still
  // need to fit). Step the font down by available width. cols present are
  // 4, 6, 8, 9; 28px is the intended size at the default/wide sizes.
  const suicideFontPx = cols >= 8 ? 28 : cols >= 6 ? 24 : 20;

  // Slot props for the header badges escape-hatch. Labelling
  // context only — badge augments read their own Topics via hooks.
  const badgesContext: LandingStatusBadgesContext = {
    bodyName: bodyName ?? null,
    atmospheric,
  };

  return (
    <Panel>
      <TitleRow>
        <PanelTitle>LANDING</PanelTitle>
        <AugmentSlot name="landing-status.badges" props={badgesContext} />
        <StreamStatusBadge status={streamStatus} />
      </TitleRow>
      {showSubtitle && bodyName !== undefined && (
        <PanelSubtitle>
          {bodyName}
          {atmospheric ? " · atmospheric" : " · vacuum"}
        </PanelSubtitle>
      )}

      {noPrediction ? (
        <EmptyState>
          {descending
            ? "Waiting for a landing prediction..."
            : "No landing in progress"}
        </EmptyState>
      ) : (
        <Body $row={isLandscape}>
          {/* Suicide burn — the headline on airless bodies. On atmospheric
              bodies KSP's prediction ignores aerobraking, so we still show it
              but demote it visually. */}
          <SuicideRow
            role={urgent ? "alert" : "status"}
            aria-live={urgent ? "assertive" : "polite"}
            $urgent={urgent}
            $muted={atmospheric}
            $stack={stackSuicide}
          >
            <SuicideLabel>Suicide burn</SuicideLabel>
            <SuicideValue
              $urgent={urgent}
              $stack={stackSuicide}
              $fontPx={suicideFontPx}
            >
              {suicideBurn === undefined || !Number.isFinite(suicideBurn)
                ? "—"
                : suicideBurn <= 0
                  ? "IGNITE"
                  : `T−${formatDuration(suicideBurn, { ms: true })}`}
            </SuicideValue>
            {atmospheric && showAtmosphericNote && (
              <SuicideNote>
                atmospheric — ignores aerobraking, treat as upper bound
              </SuicideNote>
            )}
          </SuicideRow>

          {showAnyMetricGrid && (
            <MetricGrid $row={isLandscape}>
              {showImpactRows && (
                <>
                  <MetricLabel>Impact in</MetricLabel>
                  <MetricValue>
                    {timeToImpact === undefined ||
                    !Number.isFinite(timeToImpact) ||
                    timeToImpact <= 0
                      ? "—"
                      : formatDuration(timeToImpact, { ms: true })}
                  </MetricValue>

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

              {showPredictedRow && (
                <>
                  <MetricLabel>Predicted</MetricLabel>
                  <MetricValue>
                    {isSentinel(predictedLat, predictedLon) ? (
                      "—"
                    ) : (
                      <>
                        {`${(predictedLat ?? 0).toFixed(3)}°, ${(predictedLon ?? 0).toFixed(3)}°`}
                        {/* Vacuum-exact patch walk (findImpactPoint) ignores
                            atmospheric drag — honest on an atmospheric body,
                            same "treat as upper bound" spirit as the suicide-
                            burn note above.
                            `Badge` alone, no layout wrapper — `Inline`/
                            `Stack` need a styled-components theme this
                            widget isn't guaranteed to render inside of;
                            `Badge` itself is pure CSS-custom-property,
                            theme-free. */}
                        {atmospheric && (
                          <>
                            {" "}
                            <Badge
                              tone="warn"
                              size="sm"
                              title="Vacuum-ballistic estimate — ignores atmospheric drag"
                            >
                              approx
                            </Badge>
                          </>
                        )}
                      </>
                    )}
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

const TitleRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
  flex-wrap: wrap;
`;

/*
 * Scrollable so no row is ever unreachable. At the rows>=9 gate boundary the
 * safety-critical "Skin temp" ambient row would otherwise be clipped off the
 * bottom by Panel's overflow:hidden — wrapping the body in ScrollArea lets the
 * operator reach every row.
 */
const Body = styled(ScrollArea)<{ $row?: boolean }>`
  flex: 1;
  min-height: 0;

  [data-scroll-area-inner] {
    display: flex;
    flex-direction: ${(p) => (p.$row ? "row" : "column")};
    align-items: ${(p) => (p.$row ? "flex-start" : "stretch")};
    gap: ${(p) => (p.$row ? "16px" : "8px")};
    /* Wide-short: headline and metric grid each take half the width. */
    ${(p) => p.$row && `& > * { flex: 1 1 0; min-width: 0; }`}
  }
`;

const SuicideRow = styled.div<{
  $urgent: boolean;
  $muted: boolean;
  $stack: boolean;
}>`
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
  /* Wide widgets use a two-column layout (label · value) for a single
     scannable row; narrow widgets stack so the value can claim the full
     width. minmax(0, ...) lets the flexible track shrink below the value's
     min-content width — without it, the nowrap headline forces the track
     (and the whole row) wider than the container and the value clips. */
  grid-template-columns: ${({ $stack }) =>
    $stack ? "minmax(0, 1fr)" : "auto minmax(0, 1fr)"};
  align-items: baseline;
  gap: 4px 12px;
  opacity: ${({ $muted, $urgent }) => ($muted && !$urgent ? 0.8 : 1)};
`;

const SuicideLabel = styled.span`
  font-size: var(--font-size-xs);
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--color-text-dim);
  white-space: nowrap;
`;

const SuicideValue = styled.span<{
  $urgent: boolean;
  $stack: boolean;
  $fontPx: number;
}>`
  font-size: ${({ $fontPx }) => `${$fontPx}px`};
  font-weight: 700;
  color: ${({ $urgent }) => ($urgent ? "var(--color-status-nogo-fg)" : "var(--color-status-warning-bg)")};
  letter-spacing: 0.04em;
  justify-self: ${({ $stack }) => ($stack ? "start" : "end")};
  text-align: ${({ $stack }) => ($stack ? "left" : "right")};
  white-space: nowrap;
  min-width: 0;
`;

const SuicideNote = styled.span`
  grid-column: 1 / -1;
  font-size: var(--font-size-xs);
  color: var(--color-text-dim);
  letter-spacing: 0.03em;
`;

const MetricGrid = styled.div<{ $row?: boolean }>`
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 2px 10px;
  /* No top margin when it sits beside the headline (wide-short). */
  margin-top: ${(p) => (p.$row ? "0" : "10px")};
  align-items: baseline;
  align-content: start;
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
    "Suicide-burn countdown, impact time + speed, descent rate, and predicted coordinates — focused on vacuum-body landings.",
  tags: ["telemetry", "landing"],
  defaultSize: { w: 8, h: 10 },
  minSize: { w: 4, h: 5 },
  component: LandingStatusComponent,
  dataRequirements: [
    "v.body",
    "v.heightFromTerrain",
    "vessel.surface",
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
  ],
  defaultConfig: {},
  actions: [],
  // Broad header escape-hatch slot: a badge augment can drop an
  // inline chip beside the title. No filler ships here — that's an Uplink
  // augment; the slot renders nothing until one binds.
  augmentSlots: ["landing-status.badges"],
  pushable: true,
  requires: ["flight"],
});

export { LandingStatusComponent };
