import type { Reading, Value } from "@ksp-gonogo/sitrep-sdk";
import type {
  AlarmCreator,
  AlarmManagerLookup,
} from "../shared/AlarmsLauncher";
import { AltitudeProgress } from "./AltitudeProgress";
import type { ContractEntry, ContractParameterState } from "./contracts";
import {
  type ContractParameterAlarmTrigger,
  ParameterAlarm,
} from "./ParameterAlarm";
import {
  OPTIONAL_STYLE,
  PARAMETER_TITLE_STYLE,
  PARAMETERS_STYLE,
  parameterMarkStyle,
  parameterStyle,
} from "./styles";

function parameterMark(state: ContractParameterState): string {
  if (state === "Complete") return "✓";
  if (state === "Failed") return "✕";
  if (state === "Unknown") return "?";
  return "○";
}

/** An active contract's objectives, each with its state mark, altitude progress where banded, and alarm bell. */
export function ContractParameters({
  contract: c,
  altitudeReading,
  createAlarm,
  alarmManager,
}: Readonly<{
  contract: ContractEntry;
  altitudeReading: Reading<Value<"m">>;
  createAlarm: AlarmCreator<ContractParameterAlarmTrigger> | null;
  alarmManager: AlarmManagerLookup | null;
}>) {
  if (c.parameters.length === 0) return null;
  return (
    <ul style={PARAMETERS_STYLE}>
      {c.parameters.map((p) => (
        <li key={`${c.id}-${p.title}`} style={parameterStyle(p.state)}>
          <span
            style={parameterMarkStyle(p.state)}
            // Only on the Unknown arm: report the game's own word for a state we cannot place.
            title={
              p.state === "Unknown"
                ? `Unrecognised objective state${p.stateLabel ? `: ${p.stateLabel}` : ""}`
                : undefined
            }
          >
            {parameterMark(p.state)}
          </span>
          <span style={PARAMETER_TITLE_STYLE}>
            {p.title}
            {p.optional && <span style={OPTIONAL_STYLE}> (optional)</span>}
            {p.state === "Incomplete" &&
              p.minAltitude !== undefined &&
              p.maxAltitude !== undefined && (
                <AltitudeProgress
                  min={p.minAltitude}
                  max={p.maxAltitude}
                  altitude={altitudeReading}
                />
              )}
          </span>
          {p.state === "Incomplete" && createAlarm && (
            <ParameterAlarm
              contractId={c.id}
              parameterTitle={p.title}
              createAlarm={createAlarm}
              alarmManager={alarmManager}
            />
          )}
        </li>
      ))}
    </ul>
  );
}
