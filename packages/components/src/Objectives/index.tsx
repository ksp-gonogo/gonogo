import type { ComponentProps } from "@gonogo/core";
import { registerComponent, useDataValue } from "@gonogo/core";
import { BellIcon, EmptyState, Panel, PanelTitle } from "@gonogo/ui";
import styled from "styled-components";
import {
  type ContractEntry,
  type ContractParameterAlarmTrigger,
  contractIdToSafeNumber,
  parseContracts,
} from "../ContractManager";
import { useAlarmCreator, useAlarmManager } from "../shared/AlarmsLauncher";

/**
 * Objectives — a read-only, in-flight-friendly view of everything you're
 * currently trying to achieve, unified from two sources: Making History
 * mission objectives (`mh.*`) and active-contract parameters
 * (`contracts.active`). Management (accepting/declining contracts) lives in
 * the separate Contract Manager widget; this one never writes.
 *
 * Degrades to a muted empty state when neither source has anything active,
 * which also covers either DLC/feature being absent.
 */

type ObjectivesConfig = Record<string, never>;

export type ObjectiveState = "pending" | "active" | "reached" | "failed";

export interface ObjectiveItem {
  id: string;
  title: string;
  description?: string;
  state: ObjectiveState;
  /** Parent label — the mission or contract this objective belongs to. */
  source: string;
  optional?: boolean;
  /** Set for contract parameters — enables the "alarm on completion" toggle. */
  contractId?: string;
}

export interface MissionScore {
  current: number;
  max: number;
  enabled: boolean;
}

const STATE_GLYPH: Record<ObjectiveState, string> = {
  pending: "○",
  active: "◐",
  reached: "●",
  failed: "✕",
};

function missionObjectiveState(raw: unknown): ObjectiveState {
  return raw === "active" || raw === "reached" ? raw : "pending";
}

function contractParamState(raw: string): ObjectiveState {
  if (raw === "Complete") return "reached";
  if (raw === "Failed") return "failed";
  return "pending";
}

/** Mission objectives (`mh.objectives`) → unified items, tagged by mission. */
export function missionObjectives(
  raw: unknown,
  missionName: string,
): ObjectiveItem[] {
  if (!Array.isArray(raw)) return [];
  const out: ObjectiveItem[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const e = entry as Record<string, unknown>;
    const id = typeof e.id === "string" && e.id ? e.id : "";
    const title = typeof e.title === "string" ? e.title : "";
    out.push({
      id: `mh:${id || title}`,
      title: title || "Objective",
      description:
        typeof e.description === "string" ? e.description : undefined,
      state: missionObjectiveState(e.state),
      source: missionName || "Mission",
    });
  }
  return out;
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
    // A contract can legitimately carry two parameters with the same title;
    // disambiguate the React key with a per-title occurrence count so the
    // keys stay unique (and stable) without using the array index.
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

export function parseScore(raw: unknown): MissionScore | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const e = raw as Record<string, unknown>;
  return {
    current: typeof e.current === "number" ? e.current : 0,
    max: typeof e.max === "number" ? e.max : 0,
    enabled: e.enabled === true,
  };
}

function ObjectivesComponent(_: Readonly<ComponentProps<ObjectivesConfig>>) {
  const missionAvailable = useDataValue<boolean>("data", "mh.available");
  const missionName = useDataValue<string>("data", "mh.name");
  const phase = useDataValue<string>("data", "mh.phase");
  const scoreRaw = useDataValue("data", "mh.score");
  const finished = useDataValue<boolean>("data", "mh.finished");
  const outcome = useDataValue<string>("data", "mh.outcome");
  const objectivesRaw = useDataValue("data", "mh.objectives");
  const contractsRaw = useDataValue("data", "contracts.active");
  // The one write affordance: set/clear a "warp-stop when this contract
  // parameter completes" alarm — the same feature the Contract Manager offers.
  const createAlarm = useAlarmCreator<ContractParameterAlarmTrigger>();
  const alarmManager = useAlarmManager();

  const hasMission = missionAvailable === true;
  const items: ObjectiveItem[] = [
    ...(hasMission
      ? missionObjectives(objectivesRaw, missionName ?? "Mission")
      : []),
    ...contractObjectives(parseContracts(contractsRaw) ?? []),
  ];

  const score = hasMission ? parseScore(scoreRaw) : null;
  const ended = hasMission && finished === true;
  const failed = outcome === "fail";

  // Bell toggle for an Incomplete contract parameter (mission objectives have
  // no equivalent KSP alarm). Null for everything that can't be alarmed.
  const renderAlarm = (o: ObjectiveItem) => {
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
      <AlarmBell
        type="button"
        $set={isSet}
        aria-pressed={isSet}
        title={
          isSet
            ? `Alarm set for "${o.title}" — click to clear`
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
      </AlarmBell>
    );
  };

  if (!hasMission && items.length === 0) {
    return (
      <Panel>
        <PanelTitle>OBJECTIVES</PanelTitle>
        <EmptyState role="status">No active objectives</EmptyState>
      </Panel>
    );
  }

  return (
    <Panel>
      <PanelTitle>OBJECTIVES</PanelTitle>
      <Body>
        {hasMission && (
          <MissionHead>
            <MissionName>{missionName || "Mission"}</MissionName>
            {ended ? (
              <Banner
                $failed={failed}
                role={failed ? "alert" : "status"}
                aria-live={failed ? "assertive" : "polite"}
              >
                {failed ? "MISSION FAILED" : "MISSION SUCCESS"}
              </Banner>
            ) : (
              phase && <Phase>{phase}</Phase>
            )}
            {score?.enabled && (
              <Score>
                Score <strong>{Math.round(score.current)}</strong>
                <ScoreMax> / {Math.round(score.max)}</ScoreMax>
              </Score>
            )}
          </MissionHead>
        )}

        {items.length > 0 ? (
          <List aria-label="Objectives">
            {items.map((o) => (
              <Item key={o.id} $state={o.state}>
                <Glyph $state={o.state} aria-hidden="true">
                  {STATE_GLYPH[o.state]}
                </Glyph>
                <Text>
                  <Title>
                    {o.title}
                    {o.optional && <Optional> (optional)</Optional>}
                  </Title>
                  <Sourced>{o.source}</Sourced>
                  {o.description && <Desc>{o.description}</Desc>}
                </Text>
                <VisuallyHidden>{o.state}</VisuallyHidden>
                {renderAlarm(o)}
              </Item>
            ))}
          </List>
        ) : (
          <Muted role="status">No open objectives</Muted>
        )}
      </Body>
    </Panel>
  );
}

const Body = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 4px 8px 8px;
  overflow: auto;
`;

const MissionHead = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const MissionName = styled.span`
  font-size: 13px;
  font-weight: 600;
`;

const Banner = styled.div<{ $failed: boolean }>`
  padding: 4px 8px;
  border-radius: 2px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-align: center;
  background: ${(p) =>
    p.$failed ? "var(--color-status-nogo-bg)" : "var(--color-status-go-bg)"};
  color: ${(p) =>
    p.$failed ? "var(--color-status-nogo-fg)" : "var(--color-status-go-fg)"};
`;

const Phase = styled.div`
  font-size: 11px;
  color: var(--color-text-secondary);
`;

const Score = styled.div`
  font-size: 12px;
  font-variant-numeric: tabular-nums;
`;

const ScoreMax = styled.span`
  color: var(--color-text-secondary);
`;

const List = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const STATE_COLOR: Record<ObjectiveState, string> = {
  pending: "var(--color-text-secondary)",
  active: "var(--color-status-go-fg)",
  reached: "var(--color-status-go-fg)",
  failed: "var(--color-status-nogo-fg)",
};

const Item = styled.li<{ $state: ObjectiveState }>`
  display: flex;
  gap: 6px;
  align-items: baseline;
  opacity: ${(p) => (p.$state === "pending" ? 0.6 : 1)};
`;

const Glyph = styled.span<{ $state: ObjectiveState }>`
  font-size: 11px;
  color: ${(p) => STATE_COLOR[p.$state]};
`;

const Text = styled.div`
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
  flex: 1 1 auto;
`;

const AlarmBell = styled.button<{ $set: boolean }>`
  flex: 0 0 auto;
  align-self: flex-start;
  display: inline-flex;
  padding: 2px;
  background: none;
  border: none;
  cursor: pointer;
  color: ${(p) =>
    p.$set ? "var(--color-status-go-fg)" : "var(--color-text-secondary)"};
`;

const Title = styled.span`
  font-size: 11px;
`;

const Optional = styled.span`
  color: var(--color-text-secondary);
  font-style: italic;
`;

const Sourced = styled.span`
  font-size: 9px;
  color: var(--color-text-secondary);
  letter-spacing: 0.03em;
`;

const Desc = styled.span`
  font-size: 9px;
  color: var(--color-text-secondary);
`;

const Muted = styled.div`
  font-size: 11px;
  color: var(--color-text-secondary);
`;

const VisuallyHidden = styled.span`
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
`;

registerComponent<ObjectivesConfig>({
  id: "objectives",
  name: "Objectives",
  description:
    "Read-only unified list of what you're currently trying to achieve: Making History mission objectives and active-contract parameters, each tagged with its source. Manage contracts in the Contract Manager widget.",
  tags: ["mission", "contracts", "career"],
  defaultSize: { w: 5, h: 8 },
  minSize: { w: 4, h: 3 },
  component: ObjectivesComponent,
  dataRequirements: [
    "mh.available",
    "mh.name",
    "mh.phase",
    "mh.score",
    "mh.finished",
    "mh.outcome",
    "mh.objectives",
    "contracts.active",
  ],
  defaultConfig: {},
  actions: [],
  pushable: true,
});

export { ObjectivesComponent };
