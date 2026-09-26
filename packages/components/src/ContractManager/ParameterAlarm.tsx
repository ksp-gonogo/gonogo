import { BellIcon } from "@ksp-gonogo/ui-kit";
/* `ParameterAlarmButton` needs a `:focus-visible` ring, which inline style cannot express. */
import styled from "styled-components";
import type {
  AlarmCreator,
  AlarmManagerLookup,
} from "../shared/AlarmsLauncher";
import { contractIdToSafeNumber } from "./contracts";

/**
 * Trigger shape for the parameter bells. Mirrors the app's
 * `ContractParameterTrigger`, which this package cannot import.
 */
export interface ContractParameterAlarmTrigger {
  kind: "contract-parameter";
  contractId: number;
  parameterTitle: string;
  targetState: "Complete" | "Failed";
  sustainSeconds: number;
}

/**
 * The bell beside an open objective: sets an alarm for its completion, or
 * clears the one already set. A contract id past the safe-integer range cannot
 * fit the trigger's `contractId: number`, so its bell renders disabled.
 */
export function ParameterAlarm({
  contractId,
  parameterTitle,
  createAlarm,
  alarmManager,
}: Readonly<{
  contractId: string;
  parameterTitle: string;
  createAlarm: AlarmCreator<ContractParameterAlarmTrigger>;
  alarmManager: AlarmManagerLookup | null;
}>) {
  const numericId = contractIdToSafeNumber(contractId);
  if (numericId === null) {
    return (
      <ParameterAlarmButton
        type="button"
        disabled
        title="Cannot alarm: contract id exceeds JS safe-integer range. Fix tracked in feature_log."
        aria-label="Alarm unavailable for this contract"
      >
        <BellIcon size={12} />
      </ParameterAlarmButton>
    );
  }
  const existingId =
    alarmManager?.find((trigger) => {
      if (!trigger || typeof trigger !== "object" || Array.isArray(trigger))
        return false;
      const t = trigger as Record<string, unknown>;
      return (
        t.kind === "contract-parameter" &&
        t.contractId === numericId &&
        t.parameterTitle === parameterTitle
      );
    }) ?? null;
  const isSet = existingId !== null;
  return (
    <ParameterAlarmButton
      type="button"
      $set={isSet}
      title={
        isSet
          ? `Alarm set for "${parameterTitle}": click to clear`
          : `Alarm me when "${parameterTitle}" completes`
      }
      aria-label={
        isSet
          ? `Clear alarm for ${parameterTitle}`
          : `Set alarm for ${parameterTitle} completion`
      }
      aria-pressed={isSet}
      onClick={() => {
        if (isSet && existingId && alarmManager) {
          alarmManager.remove(existingId);
          return;
        }
        createAlarm({
          name: `${parameterTitle} → Complete`,
          trigger: {
            kind: "contract-parameter",
            contractId: numericId,
            parameterTitle,
            targetState: "Complete",
            sustainSeconds: 0,
          },
        });
      }}
    >
      <BellIcon size={12} />
    </ParameterAlarmButton>
  );
}

const ParameterAlarmButton = styled.button<{ $set?: boolean }>`
  flex-shrink: 0;
  background: transparent;
  border: none;
  padding: var(--inset-control);
  cursor: pointer;
  color: ${(p) =>
    p.$set ? "var(--color-accent-fg)" : "var(--color-text-faint)"};
  display: inline-flex;
  align-items: center;

  &:hover {
    color: var(--color-accent-fg);
  }

  &:focus-visible {
    outline: 2px solid var(--color-accent-fg);
    outline-offset: 2px;
  }

  &:disabled {
    cursor: not-allowed;
    color: var(--color-text-faint);
  }
`;
