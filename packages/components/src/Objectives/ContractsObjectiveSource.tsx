import { defineTopicManifest } from "@ksp-gonogo/core";
import {
  type PendingObjectiveRow,
  unsettledObjectiveRows,
  useObservedVantage,
  usePendingObjectiveRows,
  useSelectedVantage,
  useStreamEvent,
  useViewUt,
} from "@ksp-gonogo/sitrep-client";
import { stillTrue, VesselType } from "@ksp-gonogo/sitrep-sdk";
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
  optionalChannels: ["commandCentre.roster", "trackingStation.catalog"],
  fields: [
    "career.status.contracts.active",
    "career.status.objectivesSettled",
    "commandCentre.roster.id",
    "commandCentre.roster.active",
    "commandCentre.roster.isHome",
    "trackingStation.catalog.entries",
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

/** Target state on the wire → the widget's state words. */
function heardState(target: PendingObjectiveRow["target"]): ObjectiveState {
  if (target === "Met") return "reached";
  if (target === "Failed") return "failed";
  return "pending";
}

/**
 * Whether this screen stands at the home command: its vantage is the roster's
 * home, or either is not known yet. Unknown counts as home, so nothing heard
 * from a vessel is shown before the screen knows it is somewhere else.
 */
function useAtHome(): boolean {
  const selected = useSelectedVantage();
  const observed = useObservedVantage();
  const vantage = selected ?? observed;
  const roster = stillTrue(
    contractsTopics.useTelemetry("commandCentre.roster"),
    undefined,
  );
  const homeId = roster?.find((c) => c.active && c.isHome)?.id ?? undefined;
  return vantage === undefined || homeId === undefined || vantage === homeId;
}

/**
 * Every craft in the save that can change a contract objective, anything but
 * debris and space objects, plus every one seen earlier in the session: a
 * craft lost after making a change still has its row on the way.
 */
function useCraftGuids(enabled: boolean): readonly string[] {
  const catalog = stillTrue(
    contractsTopics.useTelemetry("trackingStation.catalog"),
    undefined,
  );
  const known = useRef<string[]>([]);
  if (!enabled) return [];
  for (const entry of catalog?.entries ?? []) {
    if (
      entry.vesselType !== VesselType.Debris &&
      entry.vesselType !== VesselType.SpaceObject &&
      !known.current.includes(entry.vesselId)
    ) {
      known.current = [...known.current, entry.vesselId];
    }
  }
  return known.current;
}

/** A change this command centre has heard from a vessel and home has not acted on yet. */
export interface HeardChange {
  /** The state the objective reached at the vessel. */
  state: ObjectiveState;
  /** Seconds until word of it reaches home, or null while the vessel has no route home. */
  homeHearsInSeconds: number | null;
}

/**
 * The lookup `contractObjectives` reads each objective's heard change from.
 * Empty at home, where no vessel's news arrives before home acts on it.
 */
function useHeardChanges(
  objectivesSettled: unknown,
): (contractId: string, path: string) => HeardChange | undefined {
  const atHome = useAtHome();
  const guids = useCraftGuids(!atHome);
  const rows = usePendingObjectiveRows(atHome ? [] : guids);
  const viewUt = useViewUt();
  const byObjective = new Map<string, HeardChange>();
  for (const row of unsettledObjectiveRows(rows, objectivesSettled, atHome)) {
    if (row.contractId === null) continue;
    byObjective.set(`${row.contractId}|${row.objectivePath}`, {
      state: heardState(row.target),
      homeHearsInSeconds:
        row.homeArrivesUt === null || viewUt === undefined
          ? null
          : Math.max(0, row.homeArrivesUt - viewUt.valueOf()),
    });
  }
  return (contractId, path) => byObjective.get(`${contractId}|${path}`);
}

/**
 * When home will hear a contract is complete, or undefined when it is not
 * complete as this centre knows it: every required top-level objective met,
 * at least one of them only by news home has not acted on.
 */
function awaitingHomeOf(
  required: readonly { state: ObjectiveState; heard?: HeardChange }[],
): ObjectiveItem["awaitingHome"] {
  if (required.length === 0) return undefined;
  if (required.some((o) => o.state !== "reached")) return undefined;
  const heard = required.flatMap((o) => (o.heard ? [o.heard] : []));
  if (heard.length === 0) return undefined;
  if (heard.some((h) => h.homeHearsInSeconds === null)) {
    return { homeHearsInSeconds: null };
  }
  return {
    homeHearsInSeconds: Math.max(
      ...heard.map((h) => h.homeHearsInSeconds ?? 0),
    ),
  };
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

/**
 * Active contracts → unified items: each parameter, tagged by contract.
 * `heard` names the change, if any, this command centre has heard from a
 * vessel for the objective at a contract and path ahead of home, which the
 * item shows in place of home's state.
 */
export function contractObjectives(
  contracts: ContractEntry[],
  heard?: (contractId: string, path: string) => HeardChange | undefined,
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
    const firstItem = out.length;
    const required: { state: ObjectiveState; heard?: HeardChange }[] = [];
    const walk = (
      parameters: ContractParameter[],
      depth: number,
      parentPath: string,
    ) => {
      parameters.forEach((p, index) => {
        const occurrence = seenTitles.get(p.title) ?? 0;
        seenTitles.set(p.title, occurrence + 1);
        const path = parentPath === "" ? `${index}` : `${parentPath}/${index}`;
        const change = heard?.(c.id, path);
        const state = change?.state ?? contractParamState(p.state);
        if (depth === 0 && !p.optional) required.push({ state, heard: change });
        out.push({
          id: `c:${c.id}::${p.title}::${occurrence}`,
          title: p.title,
          description: p.notes,
          state,
          source: c.title,
          optional: p.optional,
          contractId: c.id,
          ...(depth > 0 ? { depth } : {}),
        });
        walk(p.children, depth + 1, path);
      });
    };
    walk(c.parameters, 0, "");
    const awaitingHome = awaitingHomeOf(required);
    const first = out[firstItem];
    if (awaitingHome && first) out[firstItem] = { ...first, awaitingHome };
  }
  return out;
}

/** The active-contracts source, with a per-item alarm on parameter completion. */
export function ContractsObjectiveSource({ Section }: ObjectiveSourceContext) {
  // Contracts and their parameter states change only on events, so the last board received is still the board.
  const careerReading = contractsTopics.useTelemetry("career.status");
  const career = stillTrue(careerReading, undefined);
  const contractsRaw = career?.contracts?.active;
  const heard = useHeardChanges(career?.objectivesSettled);
  const createAlarm = useAlarmCreator<ContractParameterAlarmTrigger>();
  const alarmManager = useAlarmManager();

  const finished = useFinishedContracts();
  const items = [
    ...contractObjectives(parseContracts(contractsRaw) ?? [], heard),
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
