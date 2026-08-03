import type { ComponentProps } from "@ksp-gonogo/core";
import { registerComponent, useTelemetry } from "@ksp-gonogo/core";
import {
  Badge,
  type BadgeTone,
  EmptyState,
  formatDuration,
  Inline,
  Panel,
  Stack,
  Truncate,
} from "@ksp-gonogo/ui-kit";
import type { MissionEvent, MissionEventKind } from "./events";
import { useMissionEvents } from "./useMissionEvents";

type MissionEventLogConfig = Record<string, never>;

/** Badge tone per kind, so each row reads at a glance (maps onto ui-kit tones). */
const KIND_TONE: Record<MissionEventKind, BadgeTone> = {
  launch: "go",
  "flight-ended": "neutral",
  "vessel-changed": "info",
  crash: "nogo",
  recovery: "go",
  alarm: "warn",
  staging: "info",
  "soi-change": "info",
  docking: "go",
  undocking: "neutral",
  eva: "info",
  "contract-completed": "go",
  "science-collected": "go",
};

/** Compact badge label per kind (the full sentence lives in `event.label`). */
const KIND_LABEL: Record<MissionEventKind, string> = {
  launch: "LAUNCH",
  "flight-ended": "END",
  "vessel-changed": "SWITCH",
  crash: "CRASH",
  recovery: "RECOVER",
  alarm: "ALARM",
  staging: "STAGE",
  "soi-change": "SOI",
  docking: "DOCK",
  undocking: "UNDOCK",
  eva: "EVA",
  "contract-completed": "CONTRACT",
  "science-collected": "SCIENCE",
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
      <Stack gap="xs">
        {ordered.map((e) => (
          <EventRow key={e.id} event={e} launchUt={launchUt} />
        ))}
      </Stack>
    </Panel>
  );
}

function EventRow({
  event,
  launchUt,
}: {
  event: MissionEvent;
  launchUt: number | undefined;
}) {
  const when = stamp(event.ut, launchUt);
  return (
    <Inline gap="sm" aria-label={`${event.label} at ${when}`}>
      <Badge tone={KIND_TONE[event.kind]} size="sm">
        {KIND_LABEL[event.kind]}
      </Badge>
      <Truncate>
        {when} · {event.label}
        {event.detail ? ` · ${event.detail}` : ""}
      </Truncate>
    </Inline>
  );
}

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
