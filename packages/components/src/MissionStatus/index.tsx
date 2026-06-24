import type { ComponentProps } from "@gonogo/core";
import { registerComponent, useDataValue } from "@gonogo/core";
import { EmptyState, Panel, PanelTitle } from "@gonogo/ui";
import styled from "styled-components";

/**
 * Mission Status (Making History). Read-only view of a running built mission:
 * name, current phase, score, an objective checklist, and a success/fail
 * banner when the mission ends. Gated on `mh.available`, which is true only
 * when Making History is installed AND a mission is running — so the widget
 * is silent on every sandbox/career save and when the DLC is absent.
 */

type MissionStatusConfig = Record<string, never>;

export type ObjectiveState = "pending" | "active" | "reached";

export interface MissionObjective {
  id: string;
  title: string;
  description: string;
  state: ObjectiveState;
  scoring: boolean;
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
};

export function parseObjectives(raw: unknown): MissionObjective[] {
  if (!Array.isArray(raw)) return [];
  const out: MissionObjective[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const e = entry as Record<string, unknown>;
    const state: ObjectiveState =
      e.state === "active" || e.state === "reached" ? e.state : "pending";
    const title = typeof e.title === "string" ? e.title : "";
    out.push({
      id: typeof e.id === "string" && e.id ? e.id : title,
      title,
      description: typeof e.description === "string" ? e.description : "",
      state,
      scoring: e.scoring === true,
    });
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

function MissionStatusComponent(
  _: Readonly<ComponentProps<MissionStatusConfig>>,
) {
  const available = useDataValue<boolean>("data", "mh.available");
  const name = useDataValue<string>("data", "mh.name");
  const testMode = useDataValue<boolean>("data", "mh.testMode");
  const phase = useDataValue<string>("data", "mh.phase");
  const scoreRaw = useDataValue("data", "mh.score");
  const finished = useDataValue<boolean>("data", "mh.finished");
  const outcome = useDataValue<string>("data", "mh.outcome");
  const objectivesRaw = useDataValue("data", "mh.objectives");

  if (available !== true) {
    return (
      <Panel>
        <PanelTitle>MISSION</PanelTitle>
        <EmptyState role="status">
          Making History not installed or no active mission
        </EmptyState>
      </Panel>
    );
  }

  const score = parseScore(scoreRaw);
  const objectives = parseObjectives(objectivesRaw);
  const ended = finished === true;
  const failed = outcome === "fail";

  return (
    <Panel>
      <PanelTitle>MISSION</PanelTitle>
      <Body>
        <Heading>
          <MissionName>{name || "Mission"}</MissionName>
          {testMode === true && <TestBadge>TEST</TestBadge>}
        </Heading>

        {ended ? (
          <Banner
            $failed={failed}
            role={failed ? "alert" : "status"}
            aria-live={failed ? "assertive" : "polite"}
          >
            {failed ? "MISSION FAILED" : "MISSION SUCCESS"}
          </Banner>
        ) : (
          phase && (
            <Phase role="status" aria-live="polite">
              {phase}
            </Phase>
          )
        )}

        {score?.enabled && (
          <Score>
            Score <strong>{Math.round(score.current)}</strong>
            <ScoreMax> / {Math.round(score.max)}</ScoreMax>
          </Score>
        )}

        {objectives.length > 0 && (
          <Objectives aria-label="Objectives">
            {objectives.map((o) => (
              <Objective key={o.id} $state={o.state}>
                <Glyph aria-hidden="true">{STATE_GLYPH[o.state]}</Glyph>
                <ObjectiveText>
                  <ObjectiveTitle>
                    {o.title || "Objective"}
                    {o.scoring && <ScoringTag> ★</ScoringTag>}
                  </ObjectiveTitle>
                  {o.description && (
                    <ObjectiveDesc>{o.description}</ObjectiveDesc>
                  )}
                </ObjectiveText>
                <VisuallyHidden>{o.state}</VisuallyHidden>
              </Objective>
            ))}
          </Objectives>
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

const Heading = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
`;

const MissionName = styled.span`
  font-size: 13px;
  font-weight: 600;
`;

const TestBadge = styled.span`
  font-size: 9px;
  letter-spacing: 0.08em;
  padding: 1px 4px;
  border-radius: 2px;
  background: var(--color-surface-raised);
  color: var(--color-text-secondary);
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

const Objectives = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const Objective = styled.li<{ $state: ObjectiveState }>`
  display: flex;
  gap: 6px;
  align-items: baseline;
  opacity: ${(p) => (p.$state === "pending" ? 0.55 : 1)};
`;

const Glyph = styled.span<{ children: string }>`
  color: var(--color-status-go-fg);
  font-size: 11px;
`;

const ObjectiveText = styled.div`
  display: flex;
  flex-direction: column;
  gap: 1px;
`;

const ObjectiveTitle = styled.span`
  font-size: 11px;
`;

const ScoringTag = styled.span`
  color: var(--color-status-go-fg);
`;

const ObjectiveDesc = styled.span`
  font-size: 9px;
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

registerComponent<MissionStatusConfig>({
  id: "mission-status",
  name: "Mission Status",
  description:
    "Live status of a Making History built mission: name, current phase, score, an objective checklist, and a success/fail banner when it ends. Hidden unless a mission is running.",
  tags: ["mission", "career"],
  defaultSize: { w: 5, h: 7 },
  minSize: { w: 3, h: 3 },
  component: MissionStatusComponent,
  dataRequirements: [
    "mh.available",
    "mh.name",
    "mh.testMode",
    "mh.phase",
    "mh.score",
    "mh.finished",
    "mh.outcome",
    "mh.objectives",
  ],
  defaultConfig: {},
  actions: [],
  behaviors: ["gonogo-participant"],
  pushable: true,
});

export { MissionStatusComponent };
