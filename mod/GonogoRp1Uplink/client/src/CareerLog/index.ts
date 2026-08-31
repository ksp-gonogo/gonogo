import type { ContributionEntry } from "@ksp-gonogo/sitrep-sdk";
import type {
  Rp1CareerEventEntry,
  Rp1CareerEvents,
} from "../__generated__/contract";
import { RP1 } from "../uplink";

/**
 * RP-1's own career log, handed to the Mission Log widget.
 *
 * <para><b>RP-1 has no reader for this.</b> Its career-log window is two
 * buttons: export a CSV, or upload to a configured web endpoint. There is no
 * in-game view of the rows at any point, so this is the first place an operator
 * can read their own career history without opening a spreadsheet. Nothing here
 * mirrors an RP-1 layout, because RP-1 has none to mirror.</para>
 *
 * <para>The widget derives its own rows from the live stream one edge at a time,
 * so it knows only what happened while the dashboard was open. This history
 * predates that, which is the whole reason the slot takes a SOURCE rather than
 * a row.</para>
 */

type LogSource = ContributionEntry<"mission-event-log.sources">;
type LogEvent = NonNullable<LogSource["events"]>[number];

const SOURCE_ID = "rp1-career-log";
const SOURCE_LABEL = "RP-1 career log";

/**
 * The chip on each row, from RP-1's own six list names.
 *
 * <para>A map rather than title-casing the wire value, because two of the six
 * would come out wrong: RP-1's own CSV calls these columns "Facilities" and
 * "Tech", not "Facility Construction" and "Tech Research".</para>
 */
const KIND_LABEL: Record<string, string> = {
  contract: "contract",
  launch: "launch",
  failure: "failure",
  facilityConstruction: "facility",
  techResearch: "tech",
  leader: "leader",
};

/**
 * A failure is the only kind that is not routine.
 *
 * <para>Every other kind is something the operator did on purpose. Marking those
 * would tint the whole log and distinguish nothing; leaving the failure unmarked
 * would bury the one row that is not a plan going right.</para>
 */
const KIND_SEVERITY: Record<string, LogEvent["severity"]> = {
  failure: "warning",
};

/**
 * Whatever figure the row carries.
 *
 * <para>A leader appointment has a cost, a contract has a reputation change, and
 * no kind has both, which is why the slot's channel is singular. A contract
 * `Value` already carries a magnitude and a unit, so it passes straight through
 * and the unit is never restated here.</para>
 */
function amountOf(e: Rp1CareerEventEntry): LogEvent["amount"] {
  return e.cost ?? e.repChange ?? undefined;
}

/**
 * What to call a row RP-1 recorded no name for.
 *
 * <para>Every kind carries a name now, so this is a floor rather than a path
 * anything takes: a row whose name field was empty is still a row saying
 * something happened, and dropping it would lose the instant.</para>
 */
function labelOf(e: Rp1CareerEventEntry): string {
  return e.name ?? KIND_LABEL[e.kind ?? ""] ?? "logged";
}

/**
 * A stable id per row, because the wire carries none and the host keys its rows
 * by `${source}:${id}`.
 *
 * <para>Content plus how many identical rows preceded it. Content alone is not
 * enough: RP-1 records a leader dismissed and re-hired at one instant during a
 * swap, identical in name, kind and cost, and two rows sharing a key collapse
 * into one. A plain index is not enough either, because the six lists are
 * re-read and re-sorted every poll, so a row arriving earlier in time would
 * renumber every row after it and remount rows that did not change.</para>
 */
function idsFor(events: readonly Rp1CareerEventEntry[]): string[] {
  const seen = new Map<string, number>();
  return events.map((e) => {
    const content = [e.kind, e.ut?.magnitude, e.name, e.detail].join("|");
    const nth = seen.get(content) ?? 0;
    seen.set(content, nth + 1);
    return nth === 0 ? content : `${content}#${nth}`;
  });
}

export function computeCareerLogSource(
  events: Rp1CareerEvents | undefined,
): LogSource[] {
  // RP-1 is running and its log handler has not spoken. Not an empty career:
  // whether anything has happened is unknown.
  if (events === undefined) {
    return [{ id: SOURCE_ID, label: SOURCE_LABEL, state: "unreadable" }];
  }

  if (events.enabled === false) {
    return [
      {
        id: SOURCE_ID,
        label: SOURCE_LABEL,
        state: "not-recording",
        stateReason: "career logging is off in this save",
      },
    ];
  }

  const rows = events.events ?? [];
  const ids = idsFor(rows);

  return [
    {
      id: SOURCE_ID,
      label: SOURCE_LABEL,
      // A payload that arrived without saying whether the log is being kept is
      // still unreadable. Reading absent as `recording` would turn a handler
      // that answered incompletely into a claim that the career is quiet.
      state: events.enabled === true ? "recording" : "unreadable",
      events: rows.flatMap((e, i): LogEvent[] => {
        // A row with no instant cannot go on a timeline, and placing it at zero
        // would date it to the founding of the space programme.
        if (e.ut == null) {
          return [];
        }
        return [
          {
            id: ids[i],
            ut: e.ut.magnitude,
            label: labelOf(e),
            detail: e.detail ?? e.builtAt,
            kindLabel: KIND_LABEL[e.kind ?? ""] ?? e.kind,
            severity: KIND_SEVERITY[e.kind ?? ""],
            amount: amountOf(e),
            groupId: e.launchId,
          },
        ];
      }),
    },
  ];
}

RP1.registerContribution({
  id: SOURCE_ID,
  contributes: "mission-event-log.sources",
  deps: ["rp1.careerEvents"],
  requires: "rp1",
  compute: (topics) =>
    computeCareerLogSource(
      topics["rp1.careerEvents"] as Rp1CareerEvents | undefined,
    ),
});
