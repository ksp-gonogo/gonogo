import type { ComponentProps } from "@ksp-gonogo/core";
import { registerComponent, useTelemetry } from "@ksp-gonogo/core";
import { EmptyState, formatDuration, Panel, Stack } from "@ksp-gonogo/ui-kit";
import styled from "styled-components";
import type { MissionEvent, MissionEventKind } from "./events";
import { useMissionEvents } from "./useMissionEvents";

type MissionEventLogConfig = Record<string, never>;

/** A short tone token per kind, so the log reads at a glance. */
const KIND_TONE: Record<MissionEventKind, "go" | "warn" | "nogo" | "info"> = {
  launch: "go",
  "flight-ended": "info",
  "vessel-changed": "info",
  crash: "nogo",
  recovery: "go",
  alarm: "warn",
  staging: "info",
  "soi-change": "info",
  docking: "go",
  undocking: "info",
  eva: "info",
  "contract-completed": "go",
  "science-collected": "go",
};

/**
 * Game-time stamp for an event: Mission Elapsed Time from `launchUt` when known
 * ("T+00:12:34"), else the raw UT. The event already rode the delayed stream, so
 * this happened-at time is delay-honest by construction (no as-observed needed).
 */
function stamp(ut: number, launchUt: number | undefined): string {
  if (typeof launchUt === "number" && Number.isFinite(launchUt)) {
    const met = ut - launchUt;
    return `T${met >= 0 ? "+" : "-"}${formatDuration(Math.abs(met))}`;
  }
  return `UT ${formatDuration(ut)}`;
}

function EventRow({
  event,
  launchUt,
}: {
  event: MissionEvent;
  launchUt: number | undefined;
}) {
  return (
    <Row aria-label={`${event.label} at ${stamp(event.ut, launchUt)}`}>
      <Dot $tone={KIND_TONE[event.kind]} aria-hidden="true" />
      <Time>{stamp(event.ut, launchUt)}</Time>
      <Label>
        {event.label}
        {event.detail && <Detail> · {event.detail}</Detail>}
      </Label>
    </Row>
  );
}

function MissionEventLogComponent(
  _props: Readonly<ComponentProps<MissionEventLogConfig>>,
) {
  const events = useMissionEvents();
  const launchUt = useTelemetry("vessel.identity")?.launchUt as
    | number
    | undefined;

  if (events.length === 0) {
    return (
      <Panel panelTitle="MISSION LOG">
        <EmptyState>No mission events yet</EmptyState>
      </Panel>
    );
  }

  // Newest first: a live log reads top-down from the most recent occurrence.
  const ordered = [...events].reverse();

  return (
    <Panel panelTitle="MISSION LOG" panelSubtitle={`${events.length} events`}>
      <Scroll>
        <Stack gap="xs">
          {ordered.map((e) => (
            <EventRow key={e.id} event={e} launchUt={launchUt} />
          ))}
        </Stack>
      </Scroll>
    </Panel>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────

const Scroll = styled.div`
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  margin-top: 6px;
`;

const Row = styled.div`
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: var(--font-size-sm);
`;

const Dot = styled.span<{ $tone: "go" | "warn" | "nogo" | "info" }>`
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex: 0 0 auto;
  align-self: center;
  background: ${({ $tone }) =>
    $tone === "go"
      ? "var(--color-status-go-fg)"
      : $tone === "warn"
        ? "var(--color-status-warning-fg)"
        : $tone === "nogo"
          ? "var(--color-status-nogo-fg)"
          : "var(--color-text-muted)"};
`;

const Time = styled.span`
  font-variant-numeric: tabular-nums;
  color: var(--color-text-muted);
  letter-spacing: 0.02em;
  flex: 0 0 auto;
`;

const Label = styled.span`
  color: var(--color-text-primary);
  min-width: 0;
`;

const Detail = styled.span`
  color: var(--color-text-muted);
`;

// ── Registration ──────────────────────────────────────────────────────────────

registerComponent<MissionEventLogConfig>({
  id: "mission-event-log",
  name: "Mission Log",
  description:
    "A game-time timeline of what happened this mission: launch, staging, SOI changes, docking, EVA, contracts, science, crash and recovery. Events ride the delayed stream, so each is stamped at the game-time it happened.",
  tags: ["telemetry", "mission"],
  defaultSize: { w: 8, h: 10 },
  minSize: { w: 4, h: 4 },
  component: MissionEventLogComponent,
  // Tier A discrete topics + Tier B value topics we edge-detect (see
  // useMissionEvents / events.ts). `vessel.identity` also supplies launchUt.
  dataRequirements: [
    "flight.started",
    "flight.ended",
    "flight.vesselChanged",
    "crash.lastCrash",
    "recovery.lastSummary",
    "vessel.structure",
    "vessel.orbit",
    "vessel.dock",
    "vessel.identity",
    "career.status",
  ],
  defaultConfig: {},
  actions: [],
  pushable: true,
  requires: ["flight"],
});

export { MissionEventLogComponent };
