import type { ActionDefinition, ComponentProps } from "@ksp-gonogo/core";
import {
  formatDuration,
  registerComponent,
  type TransferSolution,
  useActionInput,
  useTelemetry,
} from "@ksp-gonogo/core";
import { useViewUt } from "@ksp-gonogo/sitrep-client";
import { TargetKind } from "@ksp-gonogo/sitrep-sdk";
import { Panel, PanelTitle, Placeholder } from "@ksp-gonogo/ui";
import { useMemo, useState } from "react";
import styled from "styled-components";
import { useCelestialBodies } from "../SystemView/useCelestialBodies";
import { useAlarmCreator } from "../shared/AlarmsLauncher";
import {
  buildTransferPorkchop,
  computeTransfer,
  transferDestinations,
} from "./transferData";

/**
 * Transfer Window — interplanetary/interlunar departure planning. Client-derived
 * from the body Keplerian elements already on the wire (`system.bodies`), no mod
 * channel. Shows the phase-angle status, the next-window countdown, the ejection
 * figures, a one-click window alarm, and a porkchop (departure×arrival Δv) plot.
 *
 * The coplanar Hohmann model drives the dial/countdown/ejection readout; the
 * porkchop is inclination-aware (a full 3D Lambert grid). Origin is the vessel's
 * parent body; the destination is any sibling body sharing that parent.
 */

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

const STATUS_LABEL: Record<string, string> = {
  go: "GO",
  soon: "SOON",
  off: "HOLD",
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

  // Seed the destination from the Target API: if the operator has a body
  // targeted (`target.available`'s current Body entry), default the transfer to
  // it. An explicit pick (destIndex) always wins; otherwise fall back to the
  // targeted body, then the first sibling.
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

  const porkchop = useMemo(
    () =>
      showPorkchop && origin && dest
        ? buildTransferPorkchop({ origin, dest, bodies, nowUt })
        : null,
    [showPorkchop, origin, dest, bodies, nowUt],
  );

  if (!orbit || !origin) {
    return (
      <Panel>
        <PanelTitle>Transfer Window</PanelTitle>
        <Placeholder>Waiting for vessel orbit…</Placeholder>
      </Panel>
    );
  }
  if (dests.length === 0 || !dest) {
    return (
      <Panel>
        <PanelTitle>Transfer Window</PanelTitle>
        <Placeholder>
          No transfer destinations — {origin.name ?? "the origin body"} has no
          sibling bodies to transfer to.
        </Placeholder>
      </Panel>
    );
  }

  return (
    <Panel>
      <TitleRow>
        <PanelTitle>Transfer Window</PanelTitle>
        <RouteControl>
          <RouteLabel htmlFor="transfer-dest">
            {origin.name ?? "Origin"} →
          </RouteLabel>
          <select
            id="transfer-dest"
            value={dest.index}
            onChange={(e) => setDestIndex(Number(e.target.value))}
          >
            {dests.map((d) => (
              <option key={d.index} value={d.index}>
                {d.name ?? `Body ${d.index}`}
              </option>
            ))}
          </select>
        </RouteControl>
      </TitleRow>

      {solution ? (
        <Body>
          <PhaseDial solution={solution} />
          <Readouts>
            <Row role="status" aria-live="polite">
              <RowLabel>Phase</RowLabel>
              <RowValue>
                {solution.currentPhaseDeg.toFixed(1)}° / ideal{" "}
                {solution.idealPhaseDeg.toFixed(1)}°{" "}
                <Status $status={solution.status}>
                  {STATUS_LABEL[solution.status]}
                </Status>
              </RowValue>
            </Row>
            <Row>
              <RowLabel>Next window</RowLabel>
              <RowValue>
                {solution.status === "go"
                  ? "now"
                  : `T− ${formatDuration(solution.waitSeconds)}`}
              </RowValue>
            </Row>
            <Row>
              <RowLabel>Transfer time</RowLabel>
              <RowValue>{formatDuration(solution.transferTimeSec)}</RowValue>
            </Row>
            <Row>
              <RowLabel>Ejection Δv</RowLabel>
              <RowValue>{Math.round(solution.ejectionDeltaV)} m/s</RowValue>
            </Row>
            <Row>
              <RowLabel>Ejection angle</RowLabel>
              <RowValue>
                {solution.ejectionAngleDeg.toFixed(0)}° to prograde
              </RowValue>
            </Row>
            <Row>
              <RowLabel>v∞</RowLabel>
              <RowValue>{(solution.vInf / 1000).toFixed(2)} km/s</RowValue>
            </Row>
            {createAlarm && (
              <button
                type="button"
                onClick={() =>
                  createAlarm({
                    name: `Transfer: ${origin.name} → ${dest.name}`,
                    trigger: {
                      kind: "time",
                      ut: solution.departureUt,
                      leadSeconds,
                    },
                  })
                }
              >
                Set window alarm
              </button>
            )}
          </Readouts>
        </Body>
      ) : (
        <Placeholder>Waiting for orbital elements…</Placeholder>
      )}

      {showPorkchop && porkchop && <Porkchop grid={porkchop} />}
    </Panel>
  );
}

function PhaseDial({ solution }: { solution: TransferSolution }) {
  const R = 40;
  const cx = 50;
  const cy = 50;
  // Angles measured CCW from +x; render both markers on the circle.
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
      aria-label={`Phase angle ${solution.currentPhaseDeg.toFixed(0)} degrees, ideal ${solution.idealPhaseDeg.toFixed(0)} degrees, ${STATUS_LABEL[solution.status]}`}
    >
      <circle
        cx={cx}
        cy={cy}
        r={R}
        fill="none"
        stroke="var(--color-border-subtle)"
        strokeWidth={1}
      />
      {/* origin marker at 0° */}
      <circle cx={cx + R} cy={cy} r={2.5} fill="var(--color-text-muted)" />
      {/* ideal-phase tick */}
      <line
        x1={cx}
        y1={cy}
        x2={ideal.x}
        y2={ideal.y}
        stroke="var(--color-accent-fg)"
        strokeWidth={1}
        strokeDasharray="3 2"
      />
      {/* current-phase needle */}
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

function Porkchop({
  grid,
}: {
  grid: NonNullable<ReturnType<typeof buildTransferPorkchop>>;
}) {
  const rows = grid.cells.length;
  const cols = grid.cells[0]?.length ?? 0;
  const min = grid.minDeltaV;
  const max = grid.maxDeltaV;
  if (rows === 0 || cols === 0 || min == null || max == null) return null;
  const span = max - min || 1;
  const cell = 8;
  const w = cols * cell;
  const h = rows * cell;

  return (
    <PorkchopWrap>
      <PorkchopTitle>Porkchop — departure × arrival Δv</PorkchopTitle>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        width="100%"
        role="img"
        aria-label={`Porkchop plot, best transfer ${grid.best ? `${Math.round(grid.best.deltaV)} metres per second` : "none"}`}
      >
        {grid.cells.map((row, i) =>
          row.map((c, j) => {
            if (c.deltaV == null) return null;
            const t = (c.deltaV - min) / span; // 0 cheap → 1 dear
            const hue = 240 * (1 - t); // blue → red
            const isBest = grid.best?.i === i && grid.best?.j === j;
            return (
              <rect
                key={`${c.depUt.toFixed(0)}-${c.arrUt.toFixed(0)}`}
                x={j * cell}
                y={i * cell}
                width={cell}
                height={cell}
                fill={`hsl(${hue}, 70%, 45%)`}
                stroke={isBest ? "var(--color-accent-fg)" : "none"}
                strokeWidth={isBest ? 2 : 0}
              >
                <title>{`${Math.round(c.deltaV)} m/s`}</title>
              </rect>
            );
          }),
        )}
      </svg>
    </PorkchopWrap>
  );
}

registerComponent<TransferWindowConfig>({
  id: "transfer-window",
  name: "Transfer Window",
  description:
    "Interplanetary/interlunar departure planner: phase-angle status, next-window countdown, ejection Δv/angle, and a porkchop Δv plot. Client-derived from streamed body orbits.",
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

const TitleRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
`;

const RouteControl = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
`;

const RouteLabel = styled.label`
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
`;

const Body = styled.div`
  display: flex;
  gap: 16px;
  align-items: flex-start;
  flex-wrap: wrap;
`;

const Dial = styled.svg`
  width: 100px;
  height: 100px;
  flex-shrink: 0;
`;

const Readouts = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  flex: 1;
`;

const Row = styled.div`
  display: flex;
  justify-content: space-between;
  gap: 12px;
`;

const RowLabel = styled.span`
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
`;

const RowValue = styled.span`
  color: var(--color-text-primary);
  font-size: var(--font-size-base);
  font-variant-numeric: tabular-nums;
`;

const Status = styled.span<{ $status: string }>`
  font-weight: 700;
  letter-spacing: 0.08em;
  color: ${({ $status }) =>
    $status === "go"
      ? "var(--color-accent-fg)"
      : $status === "soon"
        ? "var(--color-status-warning-bg)"
        : "var(--color-text-dim)"};
`;

const PorkchopWrap = styled.div`
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const PorkchopTitle = styled.div`
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
`;
