import type { ComponentProps } from "@ksp-gonogo/core";
import { registerComponent, useTelemetry } from "@ksp-gonogo/core";
import {
  Badge,
  Countdown,
  EmptyState,
  Inline,
  MissionDate,
  Panel,
  type Severity,
  Stack,
  Truncate,
} from "@ksp-gonogo/ui-kit";
import { magnitudeOf } from "../shared/magnitude";
import type { MissionEvent, MissionEventKind } from "./events";
import { useMissionEvents } from "./useMissionEvents";

type MissionEventLogConfig = Record<string, never>;

// Badge severity per kind, so each row reads at a glance. `undefined` keeps the
// two decorative kinds (flight-ended / undocking, formerly `neutral`) as grey
// no-severity chips: severity has no decorative-grey tier, and Badge renders an
// undefined severity as that same grey.
const KIND_SEVERITY: Record<MissionEventKind, Severity | undefined> = {
  launch: "nominal",
  "flight-ended": undefined,
  "vessel-changed": "info",
  crash: "critical",
  recovery: "nominal",
  alarm: "warning",
  staging: "info",
  "soi-change": "info",
  docking: "nominal",
  undocking: undefined,
  eva: "info",
  "contract-completed": "nominal",
  "science-collected": "nominal",
  // A crew loss is as grave as a crash, and it is the reason the crash mattered.
  "reputation-loss": "critical",
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
  "reputation-loss": "REP",
};

/**
 * Game-time stamp for an event: Mission Elapsed Time from `launchUt` when
 * known, else the raw UT. The event already rode the delayed stream, so this
 * happened-at time is delay-honest by construction (no as-observed needed).
 *
 * The two are different quantities and take different components. An MET is a
 * CLOCK, which is what `<Countdown clock>` renders, sign and all. A bare UT is
 * an INSTANT, which is `<MissionDate>`: it is an offset from the game's epoch
 * rather than a length of time, and reading it as a duration would produce a
 * true statement about the wrong quantity.
 */
function Stamp({ ut, launchUt }: { ut: number; launchUt: number | undefined }) {
  if (typeof launchUt === "number" && Number.isFinite(launchUt)) {
    // The sign is decided HERE rather than by `clock`, because a log's zero
    // is on the other side of the boundary from a countdown's. `<Countdown
    // clock>` reads zero as `T−`, which is right when zero means "the event
    // is now, still ahead of you". Every row in a log has already happened,
    // and the instant of launch is `T+0s`: liftoff, not one second to go.
    const met = ut - launchUt;
    return (
      <>
        {met >= 0 ? "T+" : "T−"}
        <Countdown value={Math.abs(met)} />
      </>
    );
  }
  return (
    <>
      UT <MissionDate value={ut} />
    </>
  );
}

function MissionEventLogComponent(
  _props: Readonly<ComponentProps<MissionEventLogConfig>>,
) {
  const events = useMissionEvents();
  // The magnitude, not the cast that was here: `launchUt` is declared in
  // seconds and arrives as a `Value<"s">`, so casting it to `number` was an
  // assertion the compiler could not check and the `typeof` guard below
  // rejected every real frame, stamping each row with a raw UT where the MET
  // belonged.
  const launchUt =
    magnitudeOf(useTelemetry("vessel.identity")?.launchUt) ?? undefined;

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
    <Panel panelTitle="MISSION LOG">
      <Stack gap="xs">
        <span
          style={{
            fontSize: "var(--font-size-xs)",
            color: "var(--color-text-muted)",
          }}
        >
          {events.length} events
        </span>
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
  // No `aria-label` on the row. It used to carry a hand-built
  // "<label> at <time>" string, which OVERRIDES the row's own text for a
  // screen reader: the visible stamp and badge went unread and the label
  // spoke instead. The stamp now renders through the time components, which
  // already emit the spoken form beside the symbol, so the row's own text is
  // both the better reading and the one that cannot drift from what is shown.
  return (
    <Inline gap="sm">
      <Badge severity={KIND_SEVERITY[event.kind]} size="sm">
        {KIND_LABEL[event.kind]}
      </Badge>
      <Truncate>
        <Stamp ut={event.ut} launchUt={launchUt} /> · {event.label}
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
