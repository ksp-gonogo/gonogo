import { defineTopicManifest } from "@ksp-gonogo/core";
import { stillTrue } from "@ksp-gonogo/sitrep-sdk";
import { BellIcon } from "@ksp-gonogo/ui-kit";
import type { CSSProperties, ReactNode } from "react";
import {
  type ContractEntry,
  type ContractParameterAlarmTrigger,
  type ContractParameterState,
  contractIdToSafeNumber,
  parseContracts,
} from "../ContractManager";
import { useAlarmCreator, useAlarmManager } from "../shared/AlarmsLauncher";
import type {
  ObjectiveItem,
  ObjectiveSourceContext,
  ObjectiveState,
} from "./types";

export const topics = defineTopicManifest({
  channels: ["career.status"],
  fields: ["career.status.contracts.active"],
});

/** `"Unknown"` reads as pending: it is never claimed as reached or failed. */
function contractParamState(state: ContractParameterState): ObjectiveState {
  if (state === "Complete") return "reached";
  if (state === "Failed") return "failed";
  return "pending";
}

/** Active contracts → unified items: each parameter, tagged by contract. */
export function contractObjectives(
  contracts: ContractEntry[],
): ObjectiveItem[] {
  const out: ObjectiveItem[] = [];
  for (const c of contracts) {
    if (c.parameters.length === 0) {
      out.push({
        id: `c:${c.id}`,
        title: c.title,
        state: "pending",
        source: c.agency || "Contract",
      });
      continue;
    }
    // A contract can carry two parameters with the same title, so the key counts occurrences.
    const seenTitles = new Map<string, number>();
    for (const p of c.parameters) {
      const occurrence = seenTitles.get(p.title) ?? 0;
      seenTitles.set(p.title, occurrence + 1);
      out.push({
        id: `c:${c.id}::${p.title}::${occurrence}`,
        title: p.title,
        state: contractParamState(p.state),
        source: c.title,
        optional: p.optional,
        contractId: c.id,
      });
    }
  }
  return out;
}

/** The active-contracts source, with a per-item alarm on parameter completion. */
export function ContractsObjectiveSource({ Section }: ObjectiveSourceContext) {
  // Contracts and their parameter states change only on events, so the last board received is still the board.
  const contractsRaw = stillTrue(
    topics.useTelemetry("career.status"),
    undefined,
  )?.contracts?.active;
  const createAlarm = useAlarmCreator<ContractParameterAlarmTrigger>();
  const alarmManager = useAlarmManager();

  const items = contractObjectives(parseContracts(contractsRaw) ?? []);
  if (items.length === 0) return null;

  const renderAlarm = (o: ObjectiveItem): ReactNode => {
    if (o.state !== "pending" || !o.contractId || !createAlarm) return null;
    const numericId = contractIdToSafeNumber(o.contractId);
    if (numericId === null) return null;
    const existingId =
      alarmManager?.find((trigger) => {
        if (!trigger || typeof trigger !== "object" || Array.isArray(trigger))
          return false;
        const t = trigger as Record<string, unknown>;
        return (
          t.kind === "contract-parameter" &&
          t.contractId === numericId &&
          t.parameterTitle === o.title
        );
      }) ?? null;
    const isSet = existingId !== null;
    return (
      <button
        type="button"
        style={{
          ...ALARM_BELL,
          color: isSet
            ? "var(--color-status-go-fg)"
            : "var(--color-text-muted)",
        }}
        aria-pressed={isSet}
        title={
          isSet
            ? `Alarm set for "${o.title}": click to clear`
            : `Alarm me when "${o.title}" completes`
        }
        aria-label={
          isSet
            ? `Clear alarm for ${o.title}`
            : `Set alarm for ${o.title} completion`
        }
        onClick={() => {
          if (isSet && existingId && alarmManager) {
            alarmManager.remove(existingId);
            return;
          }
          createAlarm({
            name: `${o.title} → Complete`,
            trigger: {
              kind: "contract-parameter",
              contractId: numericId,
              parameterTitle: o.title,
              targetState: "Complete",
              sustainSeconds: 0,
            },
          });
        }}
      >
        <BellIcon size={12} />
      </button>
    );
  };

  return <Section items={items} renderAlarm={renderAlarm} />;
}

const ALARM_BELL: CSSProperties = {
  flex: "0 0 auto",
  alignSelf: "flex-start",
  display: "inline-flex",
  padding: "var(--inset-icon-button-tight)",
  background: "none",
  border: "none",
  cursor: "pointer",
};
