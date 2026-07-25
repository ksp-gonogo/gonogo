import type { ActionDefinition, ComponentProps } from "@ksp-gonogo/core";
import {
  type PorkchopCell,
  registerComponent,
  type TransferSolution,
  useActionInput,
  useTelemetry,
} from "@ksp-gonogo/core";
import { useViewUt } from "@ksp-gonogo/sitrep-client";
import { TargetKind } from "@ksp-gonogo/sitrep-sdk";
import { Placeholder } from "@ksp-gonogo/ui";
import {
  Badge,
  type BadgeTone,
  Button,
  FieldLabel,
  FieldRow,
  Panel,
  PanelTitle,
  ScrollArea,
  Select,
} from "@ksp-gonogo/ui-kit";
import { useEffect, useId, useMemo, useState } from "react";
import styled from "styled-components";
import { useCelestialBodies } from "../SystemView/useCelestialBodies";
import { useAlarmCreator } from "../shared/AlarmsLauncher";
import {
  buildTransferPorkchop,
  computeTransfer,
  type TransferWindowEntry,
  transferDestinations,
  upcomingWindows,
} from "./transferData";

/**
 * Transfer Window — interplanetary/interlunar departure planning. Client-derived
 * from the body Keplerian elements already on the wire (`system.bodies`), no mod
 * channel. Three linked instruments:
 *
 *  1. the DIAL — the live "right now" phase relationship (current vs ideal);
 *  2. the WINDOWS LIST — the next several departure windows to the target
 *     (countdown / Δv / transfer time); select a row to focus the chart on it
 *     and expand its detail + a set-alarm option;
 *  3. the PORKCHOP — the departure×arrival Δv surface for the selected window,
 *     with per-cell hover.
 *
 * The list ↔ chart link teaches the chart: pick a window, see its Δv surface.
 */

const WINDOW_COUNT = 5;

interface TransferWindowConfig {
  /** Show the porkchop plot. Default: true. */
  showPorkchop?: boolean;
  /** Alarm lead time in hours (warp steps down this far before the window). Default: 6. */
  leadHours?: number;
}

/** Local mirror of the app's TimeTrigger shape (components can't import app). */
interface TimeTrigger {
  kind: "time";
  ut: number;
  leadSeconds: number;
}

const transferWindowActions = [
  {
    id: "cycleDestination",
    label: "Next Destination",
    accepts: ["button"],
    description: "Cycle the transfer destination to the next sibling body.",
  },
] as const satisfies readonly ActionDefinition[];

export type TransferWindowActions = typeof transferWindowActions;

// State-descriptive labels for the phase relationship — this is an instrument
// that SHOWS state, not one that issues commands. IDEAL: the phase is at the
// Hohmann ideal; NEAR: approaching it; FAR: well off it.
const STATUS_LABEL: Record<string, string> = {
  go: "IDEAL",
  soon: "NEAR",
  off: "FAR",
};

const STATUS_TONE: Record<string, BadgeTone> = {
  go: "go",
  soon: "warn",
  off: "neutral",
};

const fmtSpeed = (ms: number): string =>
  ms >= 1000 ? `${(ms / 1000).toFixed(1)} km/s` : `${Math.round(ms)} m/s`;

const fmtDays = (sec: number): string => `${Math.round(sec / 86400)} d`;

const fmtCountdown = (sec: number): string => {
  const d = sec / 86400;
  if (d < 1) return "now";
  if (d < 1000) return `in ${Math.round(d)} d`;
  return `in ${(d / 365).toFixed(1)} y`;
};

function TransferWindowComponent({
  config,
}: ComponentProps<TransferWindowConfig>) {
  const showPorkchop = config?.showPorkchop ?? true;
  const leadSeconds = (config?.leadHours ?? 6) * 3600;

  const orbit = useTelemetry("vessel.orbit");
  const bodies = useCelestialBodies();
  const nowUt = useViewUt() ?? 0;
  const createAlarm = useAlarmCreator<TimeTrigger>();

  const origin = useMemo(
    () =>
      orbit?.referenceBodyIndex != null
        ? (bodies.find((b) => b.index === orbit.referenceBodyIndex) ?? null)
        : null,
    [bodies, orbit?.referenceBodyIndex],
  );

  const dests = useMemo(
    () => (origin ? transferDestinations(origin, bodies) : []),
    [origin, bodies],
  );

  // Seed the destination from the Target API: a targeted body defaults the
  // transfer to it. An explicit pick wins; otherwise the targeted body, then
  // the first sibling.
  const targetList = useTelemetry("target.available");
  const targetBodyIndex = useMemo(
    () =>
      targetList?.entries.find((e) => e.isCurrent && e.kind === TargetKind.Body)
        ?.bodyIndex ?? null,
    [targetList],
  );

  const [destIndex, setDestIndex] = useState<number | null>(null);
  const dest = useMemo(
    () =>
      dests.find((d) => d.index === destIndex) ??
      (targetBodyIndex != null
        ? dests.find((d) => d.index === targetBodyIndex)
        : undefined) ??
      dests[0] ??
      null,
    [dests, destIndex, targetBodyIndex],
  );

  const cycleDestination = () => {
    if (dests.length === 0) return;
    const cur = dests.findIndex((d) => d.index === (dest?.index ?? -1));
    const next = dests[(cur + 1) % dests.length];
    if (next) setDestIndex(next.index);
  };

  useActionInput<TransferWindowActions>({
    cycleDestination: () => cycleDestination(),
  });

  const parkingRadius =
    orbit?.sma != null && orbit?.ecc != null
      ? orbit.sma * (1 - orbit.ecc)
      : null;

  const solution: TransferSolution | null = useMemo(
    () =>
      origin && dest && parkingRadius != null && Number.isFinite(parkingRadius)
        ? computeTransfer({ origin, dest, bodies, parkingRadius, nowUt })
        : null,
    [origin, dest, bodies, parkingRadius, nowUt],
  );

  // The base porkchop is windowed on the next window's ideal departure; its
  // optimum is that window's Δv, which seeds the windows list.
  const basePorkchop = useMemo(
    () =>
      origin && dest
        ? buildTransferPorkchop({
            origin,
            dest,
            bodies,
            nowUt,
            centerDepUt: solution?.departureUt,
          })
        : null,
    [origin, dest, bodies, nowUt, solution?.departureUt],
  );

  const windows = useMemo(
    () =>
      solution && basePorkchop
        ? upcomingWindows(solution, basePorkchop, nowUt, WINDOW_COUNT)
        : [],
    [solution, basePorkchop, nowUt],
  );

  const [selectedWindow, setSelectedWindow] = useState(0);
  // Reset the selection when the destination changes.
  const destKey = dest?.index ?? -1;
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset only on destination change, not on selection.
  useEffect(() => setSelectedWindow(0), [destKey]);
  const selIdx = Math.min(selectedWindow, Math.max(0, windows.length - 1));
  const selected = windows[selIdx] ?? null;

  // Focus the porkchop on the selected window: window 0 is the base chart;
  // later windows rebuild centred on their own departure so their Δv surface
  // shows (each is a synodic period later, same bowl shape).
  const focusedPorkchop = useMemo(() => {
    if (!origin || !dest || !selected || selected.index === 0) {
      return basePorkchop;
    }
    return buildTransferPorkchop({
      origin,
      dest,
      bodies,
      nowUt,
      centerDepUt: selected.departureUt,
    });
  }, [origin, dest, bodies, nowUt, selected, basePorkchop]);

  if (!orbit || !origin) {
    return (
      <Panel>
        <PanelTitle>Transfer Window</PanelTitle>
        <Placeholder>Waiting for vessel orbit...</Placeholder>
      </Panel>
    );
  }
  if (dests.length === 0 || !dest) {
    return (
      <Panel>
        <PanelTitle>Transfer Window</PanelTitle>
        <Placeholder>
          No transfer destinations. {origin.name ?? "The origin body"} has no
          sibling bodies to transfer to.
        </Placeholder>
      </Panel>
    );
  }

  return (
    <Panel>
      <TitleRow>
        <PanelTitle>Transfer Window</PanelTitle>
        <FieldRow>
          <FieldLabel htmlFor="transfer-dest">
            {origin.name ?? "Origin"} to
          </FieldLabel>
          <RouteSelect
            id="transfer-dest"
            value={dest.index}
            onChange={(e) => setDestIndex(Number(e.target.value))}
          >
            {dests.map((d) => (
              <option key={d.index} value={d.index}>
                {d.name ?? `Body ${d.index}`}
              </option>
            ))}
          </RouteSelect>
        </FieldRow>
      </TitleRow>

      <Body>
        {solution ? (
          // Responsive on the body's own width (container query): stacked when
          // narrow — dial + list, then the chart below; side-by-side when wide
          // — dial + list on the left, the chart flowing to the right. The
          // chart holds a minimum size and grows to fill whatever space is free.
          <ContentGrid>
            <LeftCol>
              <NowRow>
                <PhaseDial solution={solution} />
                <NowFacts role="status" aria-live="polite">
                  <NowLabel>Current phase</NowLabel>
                  <NowValue>
                    {solution.currentPhaseDeg.toFixed(1)}°
                    <Muted>
                      {" / ideal "}
                      {solution.idealPhaseDeg.toFixed(1)}°
                    </Muted>
                  </NowValue>
                  <Badge tone={STATUS_TONE[solution.status]}>
                    {STATUS_LABEL[solution.status]}
                  </Badge>
                </NowFacts>
              </NowRow>

              <WindowsList
                windows={windows}
                selectedIndex={selIdx}
                onSelect={setSelectedWindow}
                destName={dest.name ?? "target"}
                createAlarm={
                  createAlarm
                    ? (w) =>
                        createAlarm({
                          name: `Transfer: ${origin.name} to ${dest.name}`,
                          trigger: {
                            kind: "time",
                            ut: w.departureUt,
                            leadSeconds,
                          },
                        })
                    : null
                }
              />
            </LeftCol>

            {showPorkchop && focusedPorkchop && (
              <Porkchop grid={focusedPorkchop} nowUt={nowUt} />
            )}
          </ContentGrid>
        ) : (
          <Placeholder>Waiting for orbital elements...</Placeholder>
        )}
      </Body>
    </Panel>
  );
}

function WindowsList({
  windows,
  selectedIndex,
  onSelect,
  destName,
  createAlarm,
}: {
  windows: TransferWindowEntry[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  destName: string;
  createAlarm: ((w: TransferWindowEntry) => void) | null;
}) {
  if (windows.length === 0) return null;
  return (
    <ListWrap>
      <ListTitle>Windows to {destName}</ListTitle>
      <List>
        {windows.map((w) => {
          const isSel = w.index === selectedIndex;
          return (
            <ListItem key={w.index}>
              <WindowRow
                type="button"
                $selected={isSel}
                aria-expanded={isSel}
                onClick={() => onSelect(w.index)}
              >
                <ColWait>{fmtCountdown(w.waitSeconds)}</ColWait>
                <ColDv>{fmtSpeed(w.deltaV)}</ColDv>
                <ColTof>{fmtDays(w.transferTimeSec)}</ColTof>
              </WindowRow>
              {isSel && (
                <Expander>
                  <ExpRow>
                    <ExpLabel>Departs</ExpLabel>
                    <ExpValue>+{fmtDays(w.waitSeconds)}</ExpValue>
                  </ExpRow>
                  <ExpRow>
                    <ExpLabel>Arrives</ExpLabel>
                    <ExpValue>
                      +{fmtDays(w.waitSeconds + w.transferTimeSec)}
                    </ExpValue>
                  </ExpRow>
                  <ExpRow>
                    <ExpLabel>Transfer time</ExpLabel>
                    <ExpValue>{fmtDays(w.transferTimeSec)}</ExpValue>
                  </ExpRow>
                  <ExpRow>
                    <ExpLabel>Ejection Δv</ExpLabel>
                    <ExpValue>{Math.round(w.ejectionDeltaV)} m/s</ExpValue>
                  </ExpRow>
                  <ExpRow>
                    <ExpLabel>Ejection angle</ExpLabel>
                    <ExpValue>
                      {w.ejectionAngleDeg.toFixed(0)}° to prograde
                    </ExpValue>
                  </ExpRow>
                  {createAlarm && (
                    <Button type="button" onClick={() => createAlarm(w)}>
                      Set window alarm
                    </Button>
                  )}
                </Expander>
              )}
            </ListItem>
          );
        })}
      </List>
    </ListWrap>
  );
}

function PhaseDial({ solution }: { solution: TransferSolution }) {
  const R = 40;
  const cx = 50;
  const cy = 50;
  const point = (deg: number) => {
    const a = (deg * Math.PI) / 180;
    return { x: cx + R * Math.cos(a), y: cy - R * Math.sin(a) };
  };
  const cur = point(solution.currentPhaseDeg);
  const ideal = point(solution.idealPhaseDeg);
  const color =
    solution.status === "go"
      ? "var(--color-accent-fg)"
      : solution.status === "soon"
        ? "var(--color-status-warning-bg)"
        : "var(--color-text-dim)";
  return (
    <Dial
      viewBox="0 0 100 100"
      role="img"
      aria-label={`Current phase ${solution.currentPhaseDeg.toFixed(0)} degrees, ideal ${solution.idealPhaseDeg.toFixed(0)} degrees, ${STATUS_LABEL[solution.status]}`}
    >
      <circle
        cx={cx}
        cy={cy}
        r={R}
        fill="none"
        stroke="var(--color-border-subtle)"
        strokeWidth={1}
      />
      <circle cx={cx + R} cy={cy} r={2.5} fill="var(--color-text-muted)" />
      <line
        x1={cx}
        y1={cy}
        x2={ideal.x}
        y2={ideal.y}
        stroke="var(--color-accent-fg)"
        strokeWidth={1}
        strokeDasharray="3 2"
      />
      <line
        x1={cx}
        y1={cy}
        x2={cur.x}
        y2={cur.y}
        stroke={color}
        strokeWidth={2}
      />
      <circle cx={cur.x} cy={cur.y} r={3} fill={color} />
    </Dial>
  );
}

// Continuous Δv → colour ramp: violet (the cheap optimum) sweeping through
// blue/cyan/green/yellow/orange to red (the worst). A smooth hue sweep with no
// discrete banding, so the bowl reads as smooth concentric shading. `t` is the
// capped, normalised Δv in [0,1].
const clamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t);
const rampColor = (t: number): string =>
  `hsl(${(258 * (1 - clamp01(t))).toFixed(1)}, 66%, 48%)`;

// Plot geometry (SVG user units). Margins leave room for the arrival ticks
// (left), departure ticks (bottom) and the Δv legend (right).
const VB_W = 360;
const VB_H = 300;
const M = { top: 12, right: 74, bottom: 34, left: 50 };
const PLOT_W = VB_W - M.left - M.right;
const PLOT_H = VB_H - M.top - M.bottom;

/** Three tick indices (first, middle, last) for an axis of `n` samples. */
const tickIndices = (n: number): number[] =>
  n <= 1 ? [0] : [...new Set([0, Math.floor((n - 1) / 2), n - 1])];

function Porkchop({
  grid,
  nowUt,
}: {
  grid: NonNullable<ReturnType<typeof buildTransferPorkchop>>;
  nowUt: number;
}) {
  const [hover, setHover] = useState<PorkchopCell | null>(null);
  const gradientId = useId();
  const cols = grid.cells.length; // departure axis (x), cells[i]
  const rows = grid.cells[0]?.length ?? 0; // arrival axis (y), cells[i][j]
  const min = grid.minDeltaV;
  const max = grid.maxDeltaV;
  if (cols === 0 || rows === 0 || min == null || max == null) return null;
  // Colour scale is capped near the optimum (min → min·1.8, but never past the
  // real max) so the low-Δv bullseye keeps full contour resolution; cells beyond
  // the cap (the far, off-ridge transfers) saturate in the top band, the way a
  // canonical porkchop clips its contours rather than letting outliers wash the
  // scale flat.
  const scaleMax = Math.min(max, min * 1.8);
  const scaleSpan = scaleMax - min || 1;
  const capped = scaleMax < max;
  const cellW = PLOT_W / cols;
  const cellH = PLOT_H / rows;
  const days = (sec: number) => Math.round(sec / 86400);
  const dayOffset = (ut: number) => days(ut - nowUt);
  const kms = (ms: number) => (ms / 1000).toFixed(1);

  // Cell → plot pixel. Departure increases left→right (i); arrival increases
  // bottom→top (j), so later arrivals sit at the top like a canonical porkchop.
  const cellX = (i: number) => M.left + i * cellW;
  const cellY = (j: number) => M.top + (rows - 1 - j) * cellH;

  const best = grid.best;

  return (
    <PorkchopWrap>
      <PorkchopTitle>Transfer Δv — departure vs arrival</PorkchopTitle>
      <Inspector aria-live="polite">
        {hover && hover.deltaV != null
          ? `Departs +${dayOffset(hover.depUt)}d · Arrives +${dayOffset(hover.arrUt)}d · Transfer ${days(hover.tofSec)}d · Δv ${kms(hover.deltaV)} km/s`
          : `Best ${best ? `${kms(best.deltaV)} km/s, depart +${dayOffset(best.depUt)}d` : "—"} · hover a cell for its numbers.`}
      </Inspector>
      <MapBox>
        <MapSvg
          viewBox={`0 0 ${VB_W} ${VB_H}`}
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label={`Transfer Δv contour plot, departure against arrival date. Best transfer ${best ? `${Math.round(best.deltaV)} metres per second departing ${dayOffset(best.depUt)} days from now` : "none"}.`}
        >
          <defs>
            {/* Continuous legend ramp: worst (red) at top → cheap (violet) at
              bottom, matching the plot's colour scale. */}
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={rampColor(1)} />
              <stop offset="25%" stopColor={rampColor(0.75)} />
              <stop offset="50%" stopColor={rampColor(0.5)} />
              <stop offset="75%" stopColor={rampColor(0.25)} />
              <stop offset="100%" stopColor={rampColor(0)} />
            </linearGradient>
          </defs>
          {/* Background = the worst / off-scale (≥cap) colour. The whole plot is a
            wall of that colour and only the lower-Δv cells are painted on top,
            so the good transfers read as a clean blob that blends smoothly out
            to the background. Null (no-solution) cells stay background too. */}
          <rect
            x={M.left}
            y={M.top}
            width={PLOT_W}
            height={PLOT_H}
            fill={rampColor(1)}
            pointerEvents="none"
          />
          {/* lower-Δv cells, coloured on a smooth continuous gradient */}
          {grid.cells.map((col, i) =>
            col.map((c, j) => {
              if (c.deltaV == null) return null;
              const t = (c.deltaV - min) / scaleSpan; // 0 cheap → 1 dear
              if (t >= 1) return null; // at/above the cap → background
              return (
                // biome-ignore lint/a11y/noStaticElementInteractions: decorative plot cell (svg is role=img); hover is a pointer-only enhancement, the windows list is the accessible interactive surface.
                <rect
                  className="porkchop-cell"
                  key={`${c.depUt.toFixed(0)}-${c.arrUt.toFixed(0)}`}
                  x={cellX(i)}
                  y={cellY(j)}
                  width={cellW + 0.6}
                  height={cellH + 0.6}
                  fill={rampColor(t)}
                  onMouseEnter={() => setHover(c)}
                />
              );
            }),
          )}

          {/* best-transfer marker */}
          {best && (
            <g
              stroke="var(--color-accent-fg)"
              strokeWidth={1.4}
              fill="none"
              pointerEvents="none"
            >
              <circle
                cx={cellX(best.i) + cellW / 2}
                cy={cellY(best.j) + cellH / 2}
                r={4.5}
              />
            </g>
          )}

          {/* plot frame */}
          <rect
            x={M.left}
            y={M.top}
            width={PLOT_W}
            height={PLOT_H}
            fill="none"
            stroke="var(--color-border-subtle)"
            strokeWidth={1}
            pointerEvents="none"
          />

          {/* x axis: departure */}
          {tickIndices(cols).map((i) => (
            <text
              key={`xt-${i}`}
              x={cellX(i) + cellW / 2}
              y={M.top + PLOT_H + 12}
              fontSize={9}
              textAnchor="middle"
              fill="var(--color-text-dim)"
            >
              +{dayOffset(grid.departureUts[i])}
            </text>
          ))}
          <text
            x={M.left + PLOT_W / 2}
            y={VB_H - 4}
            fontSize={9}
            textAnchor="middle"
            fill="var(--color-text-muted)"
          >
            departure — days from now
          </text>

          {/* y axis: arrival */}
          {tickIndices(rows).map((j) => (
            <text
              key={`yt-${j}`}
              x={M.left - 6}
              y={cellY(j) + cellH / 2 + 3}
              fontSize={9}
              textAnchor="end"
              fill="var(--color-text-dim)"
            >
              +{dayOffset(grid.arrivalUts[j])}
            </text>
          ))}
          <text
            x={12}
            y={M.top + PLOT_H / 2}
            fontSize={9}
            textAnchor="middle"
            fill="var(--color-text-muted)"
            transform={`rotate(-90 12 ${M.top + PLOT_H / 2})`}
          >
            arrival — days from now
          </text>

          {/* Δv legend — a continuous gradient bar with a few value ticks */}
          <rect
            x={VB_W - M.right + 20}
            y={M.top}
            width={12}
            height={PLOT_H}
            fill={`url(#${gradientId})`}
          />
          <text
            x={VB_W - M.right + 38}
            y={M.top + 7}
            fontSize={9}
            textAnchor="start"
            fill="var(--color-text-dim)"
          >
            {capped ? "≥" : ""}
            {kms(scaleMax)}
          </text>
          <text
            x={VB_W - M.right + 38}
            y={M.top + PLOT_H / 2 + 3}
            fontSize={9}
            textAnchor="start"
            fill="var(--color-text-dim)"
          >
            {kms((min + scaleMax) / 2)}
          </text>
          <text
            x={VB_W - M.right + 38}
            y={M.top + PLOT_H}
            fontSize={9}
            textAnchor="start"
            fill="var(--color-text-dim)"
          >
            {kms(min)}
          </text>
          <text
            x={VB_W - M.right + 20}
            y={M.top + PLOT_H + 12}
            fontSize={9}
            textAnchor="start"
            fill="var(--color-text-muted)"
          >
            Δv km/s
          </text>
        </MapSvg>
      </MapBox>
    </PorkchopWrap>
  );
}

registerComponent<TransferWindowConfig>({
  id: "transfer-window",
  name: "Transfer Window",
  description:
    "Interplanetary/interlunar departure planner: a live phase dial, a list of upcoming transfer windows, and a linked departure/arrival Δv map. Client-derived from streamed body orbits.",
  tags: ["telemetry", "planning"],
  defaultSize: { w: 12, h: 20 },
  minSize: { w: 6, h: 10 },
  component: TransferWindowComponent,
  dataRequirements: ["system.bodies", "vessel.orbit", "target.available"],
  defaultConfig: { showPorkchop: true, leadHours: 6 },
  actions: transferWindowActions,
  pushable: true,
  requires: ["flight"],
});

export { TransferWindowComponent };

// The scrolling body — fills the Panel below the fixed title row and scrolls
// its content within the tile (with ui-kit's fade/glow affordance). The
// scrolling children lay out via the inner element, per ScrollArea's contract.
// Full-bleed body (standing rule): the widget body reaches the widget edge —
// the dashboard grid owns the outer gutter, and the ui-kit Panel no longer adds
// its own padding. Text/readouts keep a local horizontal pad for readability;
// the Δv map and the window rows bleed back out to the edges (negative margin =
// this pad) so the chart uses the full width. The pad also cushions content
// while the Panel padding removal is still landing across the fleet.
// Text/readouts keep this much side padding; the chart and window rows go
// full-bleed to the body edge (the padless Panel owns no inset).
const TEXT_PAD = "12px";
// Container-query breakpoint (body inline-size) at which the chart flows from
// under the list (stacked) to beside it (side-by-side).
const WIDE_AT = "560px";
const Body = styled(ScrollArea)`
  flex: 1;
  min-height: 0;

  [data-scroll-area-inner] {
    /* query container so the layout reflows on the body's own width */
    container-type: inline-size;
    display: flex;
    flex-direction: column;
    padding-bottom: 8px;
  }
`;

// Holds the dial + list + chart. Stacked (dial/list, then chart below) when
// narrow; side-by-side (list left, chart right) past WIDE_AT. `min-height: 100%`
// lets the chart's flex-grow claim any spare vertical space in the tile.
const ContentGrid = styled.div`
  flex: 1;
  min-height: 100%;
  display: flex;
  flex-direction: column;
  gap: 12px;

  @container (min-width: ${WIDE_AT}) {
    flex-direction: row;
    align-items: stretch;
  }
`;

const LeftCol = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;

  @container (min-width: ${WIDE_AT}) {
    /* fixed-ish left column; the chart takes the rest of the width */
    flex: 0 1 340px;
  }
`;

const TitleRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
`;

const RouteSelect = styled(Select)`
  width: auto;
  min-width: 8rem;
`;

const NowRow = styled.div`
  display: flex;
  gap: 16px;
  align-items: center;
  padding: 0 ${TEXT_PAD};
`;

// The chart box grows to fill whatever space the tile/column gives it, down to
// a sensible minimum height. The SVG scales to fit (preserveAspectRatio meet),
// so the whole diagram — axes, legend and all — stays visible and undistorted.
const MapBox = styled.div`
  flex: 1 1 auto;
  min-height: 220px;
  min-width: 0;

  @container (min-width: ${WIDE_AT}) {
    /* beside the list it fills the row's full height */
    min-height: 0;
  }
`;

const MapSvg = styled.svg`
  width: 100%;
  height: 100%;
  display: block;
`;

const Dial = styled.svg`
  width: 96px;
  height: 96px;
  flex-shrink: 0;
`;

const NowFacts = styled.div`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  min-width: 0;
`;

const NowLabel = styled.span`
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  text-transform: uppercase;
  letter-spacing: 0.08em;
`;

const NowValue = styled.span`
  color: var(--color-text-primary);
  font-size: var(--font-size-lg);
  font-variant-numeric: tabular-nums;
`;

const Muted = styled.span`
  color: var(--color-text-dim);
  font-size: var(--font-size-base);
`;

const ListWrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const ListTitle = styled.div`
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  padding: 0 ${TEXT_PAD};
`;

const List = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const ListItem = styled.li`
  display: flex;
  flex-direction: column;
`;

const WindowRow = styled.button<{ $selected: boolean }>`
  display: grid;
  grid-template-columns: 1fr auto auto;
  gap: 12px;
  align-items: center;
  width: 100%;
  text-align: left;
  padding: 8px ${TEXT_PAD};
  background: ${({ $selected }) =>
    $selected ? "var(--color-surface-raised)" : "transparent"};
  border: 1px solid
    ${({ $selected }) =>
      $selected ? "var(--color-accent-fg)" : "var(--color-border-subtle)"};
  border-radius: 3px;
  color: var(--color-text-primary);
  font-size: var(--font-size-base);
  font-variant-numeric: tabular-nums;
  cursor: pointer;

  &:hover {
    border-color: var(--color-border-strong);
  }
  &:focus-visible {
    outline: 2px solid var(--color-accent-fg);
    outline-offset: 2px;
  }
`;

const ColWait = styled.span`
  color: var(--color-text-primary);
`;

const ColDv = styled.span`
  color: var(--color-text-muted);
`;

const ColTof = styled.span`
  color: var(--color-text-dim);
`;

const Expander = styled.div`
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 8px ${TEXT_PAD} 4px;
`;

const ExpRow = styled.div`
  display: flex;
  justify-content: space-between;
  gap: 12px;
`;

const ExpLabel = styled.span`
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
`;

const ExpValue = styled.span`
  color: var(--color-text-primary);
  font-size: var(--font-size-sm);
  font-variant-numeric: tabular-nums;
`;

// The chart column: grows to fill free space (flex) with a minimum height when
// stacked; fills the row height when beside the list.
const PorkchopWrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  flex: 1 1 auto;
  min-height: 260px;

  @container (min-width: ${WIDE_AT}) {
    min-height: 0;
  }
`;

const PorkchopTitle = styled.div`
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  padding: 0 ${TEXT_PAD};
`;

const Inspector = styled.div`
  font-size: var(--font-size-sm);
  color: var(--color-text-dim);
  font-variant-numeric: tabular-nums;
  min-height: 1.2em;
  padding: 0 ${TEXT_PAD};
`;
