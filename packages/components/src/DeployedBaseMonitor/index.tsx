import type { ComponentProps } from "@gonogo/core";
import { registerComponent, useDataValue } from "@gonogo/core";
import { EmptyState, Panel, PanelTitle } from "@gonogo/ui";
import styled from "styled-components";

/**
 * Deployed Base Monitor (Breaking Ground). Lists every deployed surface
 * science base on every body — loaded or not — with its power balance and
 * per-experiment science progress toward cap. Read-only: deployed science
 * auto-transmits and background bases can't be actioned remotely.
 *
 * Reads `deployed.bases` + `deployed.available`; degrades to a muted empty
 * state without Breaking Ground or when no base is deployed.
 */

type DeployedBaseMonitorConfig = Record<string, never>;

export interface DeployedExperiment {
  partId: number;
  id: string;
  name: string;
  total: number;
  limit: number;
  progress: number;
  stored: number;
  transmitted: number;
  collecting: boolean;
}

export interface DeployedBase {
  id: number;
  body: string;
  powered: boolean;
  partialPower: boolean;
  powerAvailable: number;
  powerRequired: number;
  controllerEnabled: boolean;
  experimentCount: number;
  experiments: DeployedExperiment[];
}

function num(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

function parseExperiments(raw: unknown): DeployedExperiment[] {
  if (!Array.isArray(raw)) return [];
  const out: DeployedExperiment[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const e = entry as Record<string, unknown>;
    out.push({
      partId: num(e.partId),
      id: typeof e.id === "string" ? e.id : "",
      name: typeof e.name === "string" && e.name ? e.name : "Experiment",
      total: num(e.total),
      limit: num(e.limit),
      progress: clamp01(num(e.progress)),
      stored: num(e.stored),
      transmitted: num(e.transmitted),
      collecting: e.collecting === true,
    });
  }
  return out;
}

/**
 * Parse `deployed.bases`. Returns null when the key is absent (older fork)
 * so the widget can tell "no DLC support" from "no bases deployed".
 */
export function parseBases(raw: unknown): DeployedBase[] | null {
  if (raw === null || raw === undefined) return null;
  if (!Array.isArray(raw)) return null;
  const out: DeployedBase[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const e = entry as Record<string, unknown>;
    if (typeof e.id !== "number") continue;
    out.push({
      id: e.id,
      body: typeof e.body === "string" ? e.body : "",
      powered: e.powered === true,
      partialPower: e.partialPower === true,
      powerAvailable: num(e.powerAvailable),
      powerRequired: num(e.powerRequired),
      controllerEnabled: e.controllerEnabled === true,
      experimentCount: num(e.experimentCount),
      experiments: parseExperiments(e.experiments),
    });
  }
  return out;
}

type PowerState = "powered" | "partial" | "unpowered";

function powerState(base: DeployedBase): PowerState {
  if (!base.powered) return "unpowered";
  return base.partialPower ? "partial" : "powered";
}

const POWER_LABEL: Record<PowerState, string> = {
  powered: "Powered",
  partial: "Brownout",
  unpowered: "Unpowered",
};

function DeployedBaseMonitorComponent(
  _: Readonly<ComponentProps<DeployedBaseMonitorConfig>>,
) {
  const basesRaw = useDataValue("data", "deployed.bases");
  const available = useDataValue<boolean>("data", "deployed.available");

  const bases = parseBases(basesRaw) ?? [];

  if (bases.length === 0) {
    return (
      <Panel>
        <PanelTitle>DEPLOYED SCIENCE</PanelTitle>
        <EmptyState role="status">
          {available === false
            ? "Breaking Ground not installed"
            : "No deployed bases"}
        </EmptyState>
      </Panel>
    );
  }

  return (
    <Panel>
      <PanelTitle>DEPLOYED SCIENCE</PanelTitle>
      <Body>
        {bases.map((base) => {
          const state = powerState(base);
          return (
            <BaseCard key={base.id}>
              <BaseHeader>
                <BaseBody>{base.body || "Surface base"}</BaseBody>
                <PowerPill $state={state} role="status">
                  <Dot $state={state} aria-hidden="true" />
                  {POWER_LABEL[state]}
                </PowerPill>
              </BaseHeader>
              <PowerLine>
                EC {Math.round(base.powerAvailable)}/
                {Math.round(base.powerRequired)}
                {base.experiments.length > 0 && (
                  <Muted> · {base.experiments.length} exp</Muted>
                )}
              </PowerLine>

              {base.experiments.map((exp) => (
                <Experiment key={`${base.id}-${exp.partId}`}>
                  <ExpRow>
                    <ExpName>{exp.name}</ExpName>
                    <ExpPct>
                      {Math.round(exp.progress * 100)}%
                      {exp.collecting && (
                        <Collecting aria-hidden="true"> ●</Collecting>
                      )}
                    </ExpPct>
                  </ExpRow>
                  <Bar>
                    <BarFill style={{ width: `${exp.progress * 100}%` }} />
                  </Bar>
                </Experiment>
              ))}
            </BaseCard>
          );
        })}
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

const BaseCard = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px 8px;
  border: 1px solid var(--color-surface-raised);
  border-radius: 2px;
`;

const BaseHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
`;

const BaseBody = styled.span`
  font-size: 12px;
  font-weight: 600;
`;

const PowerPill = styled.span<{ $state: PowerState }>`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 9px;
  letter-spacing: 0.04em;
  color: var(--color-text-secondary);
`;

const STATE_COLOR: Record<PowerState, string> = {
  powered: "var(--color-status-go-fg)",
  partial: "var(--color-status-warn-fg, #e0b020)",
  unpowered: "var(--color-status-nogo-fg)",
};

const Dot = styled.span<{ $state: PowerState }>`
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: ${(p) => STATE_COLOR[p.$state]};
`;

const PowerLine = styled.div`
  font-size: 10px;
  color: var(--color-text-secondary);
  font-variant-numeric: tabular-nums;
`;

const Muted = styled.span`
  opacity: 0.7;
`;

const Experiment = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

const ExpRow = styled.div`
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 6px;
`;

const ExpName = styled.span`
  font-size: 10px;
`;

const ExpPct = styled.span`
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  color: var(--color-text-secondary);
`;

const Collecting = styled.span`
  color: var(--color-status-go-fg);
`;

const Bar = styled.div`
  height: 4px;
  border-radius: 2px;
  background: var(--color-surface-raised);
  overflow: hidden;
`;

const BarFill = styled.div`
  height: 100%;
  background: var(--color-status-go-bg);
`;

registerComponent<DeployedBaseMonitorConfig>({
  id: "deployed-base-monitor",
  name: "Deployed Base Monitor",
  description:
    "Power balance and per-experiment science progress for Breaking Ground deployed surface bases on every body — reported even while you fly something else. Read-only.",
  tags: ["telemetry", "science"],
  defaultSize: { w: 5, h: 9 },
  minSize: { w: 4, h: 4 },
  component: DeployedBaseMonitorComponent,
  dataRequirements: ["deployed.bases", "deployed.available"],
  defaultConfig: {},
  actions: [],
  pushable: true,
});

export { DeployedBaseMonitorComponent };
