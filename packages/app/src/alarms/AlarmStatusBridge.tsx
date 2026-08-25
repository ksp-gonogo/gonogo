import { mapTopic } from "@ksp-gonogo/sitrep-client";
import type { Severity } from "@ksp-gonogo/ui-kit";
import { useStatusContribution } from "@ksp-gonogo/ui-kit";
import { useAlarmSnapshotOptional } from "./AlarmHostContext";
import type { Alarm, AlarmState } from "./types";

/**
 * `AlarmState` -> `Severity`, or `null` for a state that should not light a
 * panel. A `firing` alarm is the top non-offline severity (`critical`), an
 * `arming` one (warp stepping down toward a time alarm) is a `warning`, and
 * `pending`/`fired` contribute nothing: pending has not happened yet, and a
 * faded `fired` alarm is on its way out. This is the only graded axis alarms
 * expose today; a per-alarm severity field would fold in here if one is added.
 */
export function severityFromAlarmState(state: AlarmState): Severity | null {
  switch (state) {
    case "firing":
      return "critical";
    case "arming":
      return "warning";
    case "pending":
    case "fired":
      return null;
  }
}

/**
 * The data subject an alarm is about, as a key that can be matched against a
 * widget's declared topics, or `null` when it has no per-widget subject. A
 * threshold alarm names its `dataKey`, an event alarm its `topic`, a
 * contract-parameter alarm belongs to whatever widget reads the active
 * contracts, and a time alarm has no data subject at all (it is a mission-wide
 * countdown, so it lights no single widget).
 *
 * The contract-parameter subject is the app's own string rather than anything
 * an operator picked, so it names the wire field directly. It used to name the
 * legacy `contracts.active` key, which made a widget's attribution depend on
 * that widget still declaring the legacy vocabulary.
 */
export function alarmSubjectKey(alarm: Alarm): string | null {
  switch (alarm.trigger.kind) {
    case "threshold":
      return alarm.trigger.dataKey;
    case "event":
      return alarm.trigger.topic;
    case "contract-parameter":
      return "career.status.contracts.active";
    case "time":
      return null;
  }
}

/**
 * Whether an alarm's subject is one of the widget's declared requirements.
 *
 * Both sides are resolved to a topic first (`mapTopic`, identity when the
 * string is already one), so a widget declaring a legacy key and an alarm
 * naming a modern field still meet, in either direction. That much was always
 * here.
 *
 * The containment clause is what lets a widget declare what it actually reads.
 * A widget consuming a whole payload (`useTelemetry("career.status")`,
 * `useStream("vessel.state")`) declares the channel, while an alarm's subject
 * resolves to one field inside it, and two strings that differ by a suffix are
 * never equal. So a declaration also matches every field BENEATH it.
 *
 * The direction matters and is the whole design. Containment walks DOWN from
 * the declaration into its fields; it must never walk UP from a derived field
 * to that channel's inputs. `vessel.state.apoapsisAlt` resolves to eight input
 * topics including `vessel.comms`, so an upward walk would light the comms
 * widget for an apoapsis alarm: a loud false positive traded for a silent miss.
 */
export function alarmMatchesWidget(
  alarm: Alarm,
  declaredTopics: readonly string[] | undefined,
): boolean {
  const subject = alarmSubjectKey(alarm);
  if (subject === null) return false;
  const subjectTopic = mapTopic("data", subject) ?? subject;
  for (const requirement of declaredTopics ?? []) {
    if (requirement === subject) return true;
    const requirementTopic = mapTopic("data", requirement) ?? requirement;
    if (requirementTopic === subjectTopic) return true;
    if (subjectTopic.startsWith(`${requirement}.`)) return true;
  }
  return false;
}

/**
 * Bridges the host alarm service into the per-widget `PanelStatusStore`. It sits
 * inside a grid item's store, reads the alarm snapshot, and registers a
 * contribution for every firing/arming alarm attributed to this widget, so an
 * active alarm on the widget's subject lights that widget's summary for free
 * with the alarm's own name as the label.
 *
 * Rendered once per grid item, so it is scoped to that item's store and
 * declared topics. When no alarm host is mounted (a station screen without
 * one, most tests) it renders nothing.
 */
export function AlarmStatusBridge({
  declaredTopics,
}: {
  declaredTopics: readonly string[] | undefined;
}) {
  const snapshot = useAlarmSnapshotOptional();
  const matched = (snapshot?.alarms ?? []).filter(
    (alarm) =>
      severityFromAlarmState(alarm.state) !== null &&
      alarmMatchesWidget(alarm, declaredTopics),
  );
  return (
    <>
      {matched.map((alarm) => (
        <AlarmContribution key={alarm.id} alarm={alarm} />
      ))}
    </>
  );
}

/**
 * One firing/arming alarm's contribution into the nearest store. A component per
 * alarm so each registration is keyed on the alarm id and cleans up when the
 * alarm clears or is no longer attributed here.
 */
function AlarmContribution({ alarm }: { alarm: Alarm }) {
  const severity = severityFromAlarmState(alarm.state);
  useStatusContribution(
    severity !== null
      ? { id: `alarm:${alarm.id}`, severity, label: alarm.name }
      : null,
  );
  return null;
}
