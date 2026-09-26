import { useViewUt } from "@ksp-gonogo/sitrep-client";
import { value } from "@ksp-gonogo/sitrep-sdk";
import {
  BellIcon,
  Cluster,
  Countdown,
  ReadoutCaption,
  Truncate,
} from "@ksp-gonogo/ui-kit";
import type { PendingAlarmSummary } from "../shared/AlarmsLauncher";
import { ALARM_NAME_STYLE, FOOT_ROW_STYLE } from "./styles";

/** The soonest alarm yet to fire, the thing that ends a warp without anyone touching it. */
export function NextAlarm({ alarm }: Readonly<{ alarm: PendingAlarmSummary }>) {
  const viewUt = useViewUt();
  const remaining =
    alarm.ut === null || viewUt === undefined
      ? null
      : value("ut", alarm.ut).minus(viewUt);
  return (
    <Cluster
      justify="center"
      wrap
      style={FOOT_ROW_STYLE}
      aria-label="Next alarm"
    >
      <Cluster justify="center">
        <BellIcon size={12} aria-hidden="true" />
        <Truncate style={ALARM_NAME_STYLE}>{alarm.name}</Truncate>
      </Cluster>
      {remaining !== null && (
        <ReadoutCaption>
          <Countdown value={remaining} clock />
        </ReadoutCaption>
      )}
    </Cluster>
  );
}
