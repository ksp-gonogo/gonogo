import { defineTopicManifest } from "@ksp-gonogo/core";
import { useStreamEvent } from "@ksp-gonogo/sitrep-client";
import { stillTrue } from "@ksp-gonogo/sitrep-sdk";
import { BellIcon, IconButton, Tooltip } from "@ksp-gonogo/ui-kit";
import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  type ContractEntry,
  type ContractParameter,
  type ContractParameterState,
  parseContracts,
} from "../ContractManager";
import { useAlarmCreator, useAlarmManager } from "../shared/AlarmsLauncher";
import type {
  ObjectiveItem,
  ObjectiveSourceContext,
  ObjectiveState,
} from "./types";

export const contractsTopics = defineTopicManifest({
  channels: ["career.status", "career.contractEvent", "spaceCenter.scene"],
  fields: [
    "career.status.contracts.active",
    "career.contractEvent.id",
    "career.contractEvent.title",
    "career.contractEvent.agent",
    "career.contractEvent.outcome",
    "spaceCenter.scene.scene",
  ],
});

/** A contract heard completing, as the objectives list draws it. */
interface FinishedContract {
  id: string;
  title: string;
  agency: string;
}

/** The completion a `career.contractEvent` payload names, or null for a failure or a payload with no id. */
function completionOf(payload: unknown): FinishedContract | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  const e = payload as Record<string, unknown>;
  if (e.outcome !== "Completed" || typeof e.id !== "string") return null;
  return {
    id: e.id,
    title: typeof e.title === "string" ? e.title : "(unnamed contract)",
    agency: typeof e.agent === "string" ? e.agent : "",
  };
}

/**
 * The contracts heard completing since the scene last changed. Held in memory
 * only, so a refresh or a scene change empties it; the events replayed on
 * subscribe are not counted.
 */
function useFinishedContracts(): FinishedContract[] {
  const [finished, setFinished] = useState<FinishedContract[]>([]);
  useStreamEvent<unknown>("career.contractEvent", (payload) => {
    const done = completionOf(payload);
    if (done === null) return;
    setFinished((held) =>
      held.some((c) => c.id === done.id) ? held : [...held, done],
    );
  });
  const scene = stillTrue(
    contractsTopics.useTelemetry("spaceCenter.scene"),
    undefined,
  )?.scene;
  const lastScene = useRef(scene);
  useEffect(() => {
    if (scene == null) return;
    if (lastScene.current != null && scene !== lastScene.current) {
      setFinished([]);
    }
    lastScene.current = scene;
  }, [scene]);
  return finished;
}

/**
 * Trigger shape for the parameter bells. Mirrors the app's
 * `ContractParameterTrigger`, which this package cannot import.
 */
interface ContractParameterAlarmTrigger {
  kind: "contract-parameter";
  contractId: string;
  parameterTitle: string;
  targetState: "Complete" | "Failed";
  sustainSeconds: number;
}

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
    const walk = (parameters: ContractParameter[], depth: number) => {
      for (const p of parameters) {
        const occurrence = seenTitles.get(p.title) ?? 0;
        seenTitles.set(p.title, occurrence + 1);
        out.push({
          id: `c:${c.id}::${p.title}::${occurrence}`,
          title: p.title,
          description: p.notes,
          state: contractParamState(p.state),
          source: c.title,
          optional: p.optional,
          contractId: c.id,
          ...(depth > 0 ? { depth } : {}),
        });
        walk(p.children, depth + 1);
      }
    };
    walk(c.parameters, 0);
  }
  return out;
}

/** The active-contracts source, with a per-item alarm on parameter completion. */
export function ContractsObjectiveSource({ Section }: ObjectiveSourceContext) {
  // Contracts and their parameter states change only on events, so the last board received is still the board.
  const careerReading = contractsTopics.useTelemetry("career.status");
  const contractsRaw = stillTrue(careerReading, undefined)?.contracts?.active;
  const createAlarm = useAlarmCreator<ContractParameterAlarmTrigger>();
  const alarmManager = useAlarmManager();

  const finished = useFinishedContracts();
  const items = [
    ...contractObjectives(parseContracts(contractsRaw) ?? []),
    ...finished.map(
      (c): ObjectiveItem => ({
        id: `done:${c.id}`,
        title: c.title,
        state: "reached",
        source: c.agency || "Contract",
      }),
    ),
  ];
  if (items.length === 0) return null;

  const renderAlarm = (o: ObjectiveItem): ReactNode => {
    const contractId = o.contractId;
    if (o.state !== "pending" || !contractId || !createAlarm) return null;
    const existingId =
      alarmManager?.find((trigger) => {
        if (!trigger || typeof trigger !== "object" || Array.isArray(trigger))
          return false;
        const t = trigger as Record<string, unknown>;
        return (
          t.kind === "contract-parameter" &&
          t.contractId === contractId &&
          t.parameterTitle === o.title
        );
      }) ?? null;
    const isSet = existingId !== null;
    return (
      <Tooltip
        text={
          isSet
            ? `Alarm set for "${o.title}": click to clear`
            : `Alarm me when "${o.title}" completes`
        }
      >
        <IconButton
          type="button"
          style={ALARM_BELL}
          aria-pressed={isSet}
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
                contractId,
                parameterTitle: o.title,
                targetState: "Complete",
                sustainSeconds: 0,
              },
            });
          }}
        >
          <BellIcon size={12} />
        </IconButton>
      </Tooltip>
    );
  };

  return (
    <Section items={items} renderAlarm={renderAlarm} held={careerReading} />
  );
}

const ALARM_BELL: CSSProperties = {
  flex: "0 0 auto",
  alignSelf: "flex-start",
};
