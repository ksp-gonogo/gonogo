import type { ComponentProps } from "@ksp-gonogo/core";
import {
  registerComponent,
  useContributions,
  useTelemetry,
} from "@ksp-gonogo/core";
import type { Reading } from "@ksp-gonogo/sitrep-client";
import { value } from "@ksp-gonogo/sitrep-sdk";
import {
  Badge,
  Countdown,
  EmptyState,
  Inline,
  MissionDate,
  Panel,
  type Severity,
  Stack,
  Text,
  Truncate,
  Unit,
} from "@ksp-gonogo/ui-kit";
import { magnitudeOf } from "../shared/magnitude";
import type { MissionEvent, MissionEventKind } from "./events";
import { type MissionLogRow, mergeLogRows, resolveLogSources } from "./sources";
import { useMissionEvents } from "./useMissionEvents";

type MissionEventLogConfig = Record<string, never>;

// Badge severity per kind, so each row reads at a glance. `undefined` keeps the
// two decorative kinds (flight-ended / undocking) as grey
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
 * The value of a FACT: something that stays true until an event changes it, and no
 * event can reach us down a link that is not delivering. `whenConfirmedNothing` is
 * what an `absent` tombstone means here, which is a different answer from `pending`
 * and must not collapse into it.
 */
function stillTrue<T, A>(
  reading: Reading<T>,
  whenConfirmedNothing: A,
): T | A | undefined {
  if (reading.state === "observed") return reading.value;
  if (reading.state === "stale") return reading.value;
  if (reading.state === "reckonable") return reading.value;
  if (reading.state === "absent") return whenConfirmedNothing;
  return undefined;
}

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
  /**
   * The launch instant is a fact, so it is held rather than withheld: a vessel
   * that left the pad at UT 900 did not leave at some other UT because the link
   * later went quiet, and dropping the read would silently reformat every row of
   * a mission's history from a mission-elapsed clock to a raw UT, mid-mission,
   * on nothing but a stream hiccup.
   *
   * The magnitude, not the cast that was here: `launchUt` is declared in seconds
   * and arrives as a `Value<"s">`, so casting it to `number` was an assertion
   * the compiler could not check and the `typeof` guard in `Stamp` rejected
   * every real frame, stamping each row with a raw UT where the MET belonged.
   */
  const launchUt =
    magnitudeOf(
      stillTrue(useTelemetry("vessel.identity"), undefined)?.launchUt,
    ) ?? undefined;

  /**
   * What other packages have recorded that this widget never saw happen. An
   * absent Uplink contributes nothing and the log is exactly what it always was.
   */
  const contributed = useContributions("mission-event-log.sources");
  const sources = resolveLogSources(contributed);
  const rows = mergeLogRows(events.map(ownRow), contributed);
  const notes = sources
    .map((s) => s.note)
    .filter((n): n is string => n !== null);

  if (rows.length === 0 && notes.length === 0) {
    return (
      <Panel panelTitle="MISSION LOG">
        <EmptyState>No mission events yet</EmptyState>
      </Panel>
    );
  }

  // Newest first: a live log reads top-down from the most recent occurrence.
  const ordered = [...rows].reverse();

  return (
    <Panel panelTitle="MISSION LOG">
      <Stack gap="xs">
        {notes.map((note) => (
          <Text key={note} tone="muted" size="xs">
            {note}
          </Text>
        ))}
        {rows.length === 0 ? (
          <EmptyState>No mission events yet</EmptyState>
        ) : (
          <>
            <Text tone="muted" size="xs">
              {rows.length} events
            </Text>
            {ordered.map((row) => (
              <EventRow key={row.key} row={row} launchUt={launchUt} />
            ))}
          </>
        )}
      </Stack>
    </Panel>
  );
}

/** The widget's own event, as a row of the merged timeline. */
function ownRow(event: MissionEvent): MissionLogRow {
  return {
    key: event.id,
    ut: event.ut,
    label: event.label,
    detail: event.detail,
    badgeLabel: KIND_LABEL[event.kind],
    severity: KIND_SEVERITY[event.kind],
  };
}

function EventRow({
  row,
  launchUt,
}: {
  row: MissionLogRow;
  launchUt: number | undefined;
}) {
  // No `aria-label` on the row. A hand-built "<label> at <time>" string
  // OVERRIDES the row's own text for a screen reader, so the visible stamp and
  // badge go unread and the label speaks instead. The stamp renders through the
  // time components, which already emit the spoken form beside the symbol, so
  // the row's own text is both the better reading and the one that cannot drift
  // from what is shown.
  return (
    <Inline gap="sm">
      <Badge severity={row.severity} size="sm">
        {row.badgeLabel}
      </Badge>
      <Truncate>
        <Stamp ut={row.ut} launchUt={launchUt} /> · {row.label}
        {row.detail ? ` · ${row.detail}` : ""}
        {row.amount ? (
          <>
            {" · "}
            {/* Minted here rather than carried, because a contributed row is a
                magnitude and a unit: `Unit` is the app's only quantity
                renderer, so the figure has to become a real value on this side
                of the boundary rather than arrive pre-formatted. */}
            <Unit
              value={value(row.amount.unit, row.amount.magnitude)}
              decimals={0}
            />
          </>
        ) : null}
        {row.groupTag ? (
          <Text tone="faint" spaced>{`⟨${row.groupTag}⟩`}</Text>
        ) : null}
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
  contributionSlots: ["mission-event-log.sources"],
  actions: [],
  pushable: true,
  requires: ["flight"],
});

export { MissionEventLogComponent };
