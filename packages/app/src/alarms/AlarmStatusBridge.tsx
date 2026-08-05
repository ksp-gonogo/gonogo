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
 * widget's `dataRequirements`, or `null` when it has no per-widget subject. A
 * threshold alarm names its `dataKey`, an event alarm its `topic`, a
 * contract-parameter alarm belongs to whatever widget reads `contracts.active`,
 * and a time alarm has no data subject at all (it is a mission-wide countdown,
 * so it lights no single widget).
 */
export function alarmSubjectKey(alarm: Alarm): string | null {
  switch (alarm.trigger.kind) {
    case "threshold":
      return alarm.trigger.dataKey;
    case "event":
      return alarm.trigger.topic;
    case "contract-parameter":
      return "contracts.active";
    case "time":
      return null;
  }
}

/**
 * Whether an alarm's subject is one of the widget's declared requirements. The
 * match is topic-resolved the same way `useWidgetStreamStatus` resolves stream
 * staleness: a requirement matches if it equals the subject, if the requirement
 * maps to the subject topic, or if the subject maps to the requirement topic.
 * That covers a widget declaring a legacy DataSource key while the alarm names a
 * topic, and vice versa.
 */
export function alarmMatchesWidget(
  alarm: Alarm,
  dataRequirements: readonly string[] | undefined,
): boolean {
  const subject = alarmSubjectKey(alarm);
  if (subject === null) return false;
  for (const requirement of dataRequirements ?? []) {
    if (requirement === subject) return true;
    if (mapTopic("data", requirement) === subject) return true;
    if (mapTopic("data", subject) === requirement) return true;
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
 * `dataRequirements`. When no alarm host is mounted (a station screen without
 * one, most tests) it renders nothing.
 */
export function AlarmStatusBridge({
  dataRequirements,
}: {
  dataRequirements: readonly string[] | undefined;
}) {
  const snapshot = useAlarmSnapshotOptional();
  const matched = (snapshot?.alarms ?? []).filter(
    (alarm) =>
      severityFromAlarmState(alarm.state) !== null &&
      alarmMatchesWidget(alarm, dataRequirements),
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
