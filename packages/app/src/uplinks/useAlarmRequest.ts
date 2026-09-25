import { useAlarmCreator } from "@ksp-gonogo/components";
import type {
  UplinkAlarmRequest,
  UplinkAlarmTrigger,
  UplinkClientHandle,
} from "@ksp-gonogo/sitrep-sdk";
import { useCallback } from "react";
import type { AlarmTrigger } from "../alarms/types";
import { DEFAULT_LEAD_SECONDS, DEFAULT_SUSTAIN_SECONDS } from "../alarms/types";

/**
 * The app's implementation of the sdk's `useAlarmRequest`: an Uplink asks for
 * an alarm, and the app creates and owns the result.
 *
 * It routes through the `AlarmCreator` context that `AlarmsLauncherBridge`
 * already mounts around the dashboard on BOTH screens, rather than reaching for
 * an alarm service directly. That is the whole reason a station works for free:
 * on the main screen the creator lands on `AlarmHostService.addAlarm`, on a
 * station it lands on `AlarmClientService.addAlarm`, which sends the request to
 * the host, whose `AlarmPeerBridge` calls the same `addAlarm`. One mechanism,
 * already load-bearing for the operator's own adds.
 *
 * Null creator (no bridge mounted) returns a no-op rather than throwing: a
 * widget rendered in a probe harness or outside the dashboard should not crash
 * on a button it offers, and there is no alarm list for the request to reach.
 */
export function useAlarmRequest(
  owner: UplinkClientHandle,
): (request: UplinkAlarmRequest) => void {
  const creator = useAlarmCreator<AlarmTrigger>();
  const { id: uplinkId, name: uplinkName } = owner;
  return useCallback(
    (request: UplinkAlarmRequest) => {
      if (!creator) return;
      creator({
        name: request.name,
        trigger: toAlarmTrigger(request.trigger),
        requestedBy: { uplinkId, uplinkName, key: request.key },
      });
    },
    [creator, uplinkId, uplinkName],
  );
}

/**
 * The published request trigger as the app's own union.
 *
 * The two shapes differ in one substantive way: a threshold is addressed out
 * there as a Topic and a path, and the app's own arm additionally carries the
 * joined `dataKey` the row and the picker name it by. It is derived here rather
 * than asked for, because the join is the app's spelling of an address the
 * caller already gave, and a caller free to spell it themselves is a caller
 * free to spell it differently from the Topic they named.
 */
function toAlarmTrigger(trigger: UplinkAlarmTrigger): AlarmTrigger {
  if (trigger.kind === "time") {
    return {
      kind: "time",
      ut: trigger.ut,
      leadSeconds: trigger.leadSeconds ?? DEFAULT_LEAD_SECONDS,
    };
  }
  return {
    kind: "threshold",
    dataKey: `${trigger.topic}.${trigger.fieldPath}`,
    topic: trigger.topic,
    fieldPath: trigger.fieldPath,
    op: trigger.op,
    value: trigger.value,
    sustainSeconds: trigger.sustainSeconds ?? DEFAULT_SUSTAIN_SECONDS,
    vantage: trigger.vantage ?? "command",
  };
}
