import type { ComponentProps } from "@ksp-gonogo/core";
import {
  AugmentSlot,
  registerComponent,
  useDataStreamStatus,
  useTelemetry,
} from "@ksp-gonogo/core";
import {
  EmptyState,
  Panel,
  PanelTitle,
  StreamStatusBadge,
} from "@ksp-gonogo/ui";
import styled from "styled-components";

/**
 * Deployed Base Monitor (Breaking Ground). Lists every deployed surface
 * science base on every body — loaded or not — with its power balance and
 * per-experiment science progress toward cap. Read-only: deployed science
 * auto-transmits and background bases can't be actioned remotely.
 *
 * Reads `deployed.bases` + `deployed.available`; degrades to a muted empty
 * state without Breaking Ground or when no base is deployed.
 *
 * `deployed.bases` is migrated — `map-topic.ts` routes it onto the new
 * `science.deployed` stream topic (`mod/Sitrep.Host/ScienceViewProvider.cs`'s
 * `BuildDeployed`, itself fed by `Gonogo.KSP.KspHost.BuildDeployedScience`'s
 * GLOBAL `FlightGlobals.Vessels` walk — a Breaking Ground cluster is its own
 * vessel, never the active one). `parseBases` below now accepts BOTH wire
 * shapes; see its own doc comment for the field-by-field mapping.
 * `deployed.available` is migrated too — the earlier "no new-wire
 * equivalent" read was stale: `game.dlc.breakingGround` is its
 * own independent capability boolean, not derived from `science.deployed`'s
 * emptiness (see `map-topic.ts`'s `TELEMACHUS_CLEAN_HOMES`).
 *
 * Real-recording validation is deferred to the user's next Space Center
 * capture with a deployed Breaking Ground cluster in physics range — this
 * migration validates against a hand-authored real-shape SYNTHETIC fixture
 * (`.superpowers/sdd/m3-deployedscience-report.md`).
 */

type DeployedScienceConfig = Record<string, never>;

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

/** One flat entry off the new `science.deployed` wire — see `parseBases`'s doc comment. */
interface FlatDeployedEntry {
  vesselName: string;
  partName: string | null;
  body: string | null;
  experimentId: string | null;
  scienceCompletedPercentage: number;
  scienceTransmittedPercentage: number;
  scienceValue: number;
  scienceLimit: number;
  powerState: string | null;
  connectionState: string | null;
}

function parseFlatDeployedEntry(entry: unknown): FlatDeployedEntry | null {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  const e = entry as Record<string, unknown>;
  if (typeof e.vesselName !== "string" || !e.vesselName) return null;
  return {
    vesselName: e.vesselName,
    partName: typeof e.partName === "string" ? e.partName : null,
    body: typeof e.body === "string" ? e.body : null,
    experimentId: typeof e.experimentId === "string" ? e.experimentId : null,
    scienceCompletedPercentage: num(e.scienceCompletedPercentage),
    scienceTransmittedPercentage: num(e.scienceTransmittedPercentage),
    scienceValue: num(e.scienceValue),
    scienceLimit: num(e.scienceLimit),
    powerState: typeof e.powerState === "string" ? e.powerState : null,
    connectionState:
      typeof e.connectionState === "string" ? e.connectionState : null,
  };
}

/**
 * Coarse `powerState` enum ("Powered" | "NoPower" — decompile-confirmed —
 * or any other non-empty string a future KSP version might add, e.g. a
 * hypothetical "PartiallyPowered") -> the widget's existing
 * `powered`/`partialPower` boolean pair. `ModuleGroundSciencePart.PowerState`
 * is a free string field, not a closed enum this codebase controls, so an
 * unrecognized non-empty value is treated as "some power, but not full"
 * rather than dropped.
 */
function powerFromState(powerState: string | null): {
  powered: boolean;
  partialPower: boolean;
} {
  if (powerState === "Powered") return { powered: true, partialPower: false };
  if (!powerState || powerState === "NoPower") {
    return { powered: false, partialPower: false };
  }
  return { powered: true, partialPower: true };
}

/**
 * Groups the new wire's FLAT per-experiment list (see `parseBases`'s doc
 * comment) into the widget's existing `DeployedBase[]` display shape, keyed
 * by `vesselName` — a Breaking Ground cluster is its own vessel
 * (`Gonogo.KSP.KspHost.BuildDeployedScience`'s doc comment), so grouping by
 * vessel reproduces the legacy "one card per base" layout. Fields with no
 * new-wire equivalent degrade explicitly:
 * - `powerAvailable`/`powerRequired` -> `0`/`0` (only the coarse
 *   `powerState` enum exists, no EC numbers).
 * - `controllerEnabled` -> derived from `connectionState === "Connected"`
 *   (closest available proxy; unused in the current render either way).
 * - `id`/`partId` -> synthesized indices (stable within one payload, and
 *   never rendered as text — only used as React list keys).
 */
function groupFlatDeployedEntries(raw: unknown[]): DeployedBase[] {
  const order: string[] = [];
  const groups = new Map<string, FlatDeployedEntry[]>();
  for (const rawEntry of raw) {
    const entry = parseFlatDeployedEntry(rawEntry);
    if (!entry) continue;
    let list = groups.get(entry.vesselName);
    if (!list) {
      list = [];
      groups.set(entry.vesselName, list);
      order.push(entry.vesselName);
    }
    list.push(entry);
  }

  return order.map((vesselName, baseIndex) => {
    const entries = groups.get(vesselName) ?? [];
    const first = entries[0];
    const { powered, partialPower } = powerFromState(first?.powerState ?? null);
    const experiments: DeployedExperiment[] = entries.map((e, i) => {
      const progress = clamp01(e.scienceCompletedPercentage / 100);
      const transmitted =
        e.scienceValue * clamp01(e.scienceTransmittedPercentage / 100);
      return {
        partId: i,
        id: e.experimentId ?? `${vesselName}-${i}`,
        name: e.partName || e.experimentId || "Experiment",
        total: e.scienceValue,
        limit: e.scienceLimit,
        progress,
        stored: Math.max(0, e.scienceValue - transmitted),
        transmitted,
        collecting: e.scienceCompletedPercentage < 100,
      };
    });
    return {
      id: baseIndex,
      body: first?.body ?? "",
      powered,
      partialPower,
      powerAvailable: 0,
      powerRequired: 0,
      controllerEnabled: first?.connectionState === "Connected",
      experimentCount: experiments.length,
      experiments,
    };
  });
}

/**
 * Parse `deployed.bases`. Returns null when the key is absent (older fork)
 * so the widget can tell "no DLC support" from "no bases deployed". Two wire
 * shapes land here:
 *
 * - **Legacy GonogoTelemetry shape**: grouped per-base objects — a numeric
 *   `id`, an EC `powerAvailable`/`powerRequired` balance, and a nested
 *   `experiments` list already keyed by numeric `partId`.
 * - **New SDK `science.deployed`** (routed onto this key by
 *   `map-topic.ts`): a FLAT array of individual deployed
 *   experiments — one entry per `ModuleGroundExperiment`, no base grouping
 *   — `{ vesselName, partName, body, situation, biome, experimentId,
 *   scienceCompletedPercentage, scienceTransmittedPercentage, scienceValue,
 *   scienceLimit, powerState, connectionState, deployedOnGround }`
 *   (`mod/Sitrep.Host/ScienceViewProvider.cs`'s `BuildDeployedEntry`).
 *   `groupFlatDeployedEntries` above derives an equivalent `DeployedBase[]`
 *   client-side, grouped by `vesselName`.
 *
 * Detected by shape: a legacy entry always carries a numeric `id`; a
 * new-wire entry never does but always carries a string `vesselName`
 * instead. The two shapes never mix within one array (one source or the
 * other populates the whole payload), so the first recognizable entry
 * decides how the rest of the array is read.
 */
export function parseBases(raw: unknown): DeployedBase[] | null {
  if (raw === null || raw === undefined) return null;
  if (!Array.isArray(raw)) return null;

  for (const entry of raw) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const e = entry as Record<string, unknown>;
    if (typeof e.vesselName === "string" && typeof e.id !== "number") {
      return groupFlatDeployedEntries(raw);
    }
    break;
  }

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

function DeployedScienceComponent(
  _: Readonly<ComponentProps<DeployedScienceConfig>>,
) {
  const basesRaw = useTelemetry("science.deployed");
  const available = useTelemetry("game.dlc")?.breakingGround;
  const basesStreamStatus = useDataStreamStatus("data", "deployed.bases");

  const bases = parseBases(basesRaw) ?? [];

  if (bases.length === 0) {
    return (
      <Panel>
        <TitleRow>
          <PanelTitle>DEPLOYED SCIENCE</PanelTitle>
          {/* Header escape-hatch badges slot (augment-slot-map: broad
              escape-hatch). Any Uplink can drop an inline badge next to the
              title. Renders nothing until an augment binds
              `deployed-science.badges`. */}
          <AugmentSlot name="deployed-science.badges" props={{}} />
          <StreamStatusBadge status={basesStreamStatus} />
        </TitleRow>
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
      <TitleRow>
        <PanelTitle>DEPLOYED SCIENCE</PanelTitle>
        {/* Header escape-hatch badges slot (augment-slot-map: broad
            escape-hatch). Any Uplink can drop an inline badge next to the
            title. Renders nothing until an augment binds
            `deployed-science.badges`. */}
        <AugmentSlot name="deployed-science.badges" props={{}} />
        <StreamStatusBadge status={basesStreamStatus} />
      </TitleRow>
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
                  {/* Per-experiment-card body slot (augment-slot-map:
                      deployed-science.sections). A Kerbalism Uplink appends a
                      background-transmission progress bar here; because the
                      slot renders once PER experiment card, its props carry
                      THIS card's experiment datum (and its body) so the
                      augment targets the right experiment. Renders nothing
                      until an augment binds. */}
                  <AugmentSlot
                    name="deployed-science.sections"
                    props={{ experiment: exp, body: base.body }}
                  />
                </Experiment>
              ))}
            </BaseCard>
          );
        })}
      </Body>
    </Panel>
  );
}

const TitleRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
`;

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
  partial: "var(--color-status-warning-fg-muted)",
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

// ── Augment slots ─────────────────────────────────────────────────────────────

/**
 * Props passed to every `deployed-science.sections` augment. The slot renders
 * once PER experiment card, so its props MUST carry that card's experiment
 * datum — a Kerbalism-style Uplink appends a background-transmission progress
 * bar and needs THIS experiment's identity/progress to target the right one.
 * `body` is the parent base's body, for context.
 */
export interface DeployedExperimentContext {
  /** The deployed experiment this card renders — the augment's datum. */
  experiment: DeployedExperiment;
  /** The body the parent base sits on, for context. */
  body: string;
}

// Declaration-merge this widget's slot ids → their props types into core's
// `SlotRegistry` (Uplink architecture §4.6). Kept co-located here, not in a
// shared central registry file, so parallel per-widget slot work never
// collides. `.sections` is a typed-contract per-card slot (carries the
// experiment); `.badges` is a plain header escape-hatch (no props).
declare module "@ksp-gonogo/core" {
  interface SlotRegistry {
    "deployed-science.sections": DeployedExperimentContext;
    "deployed-science.badges": Record<string, never>;
  }
}

// ── Registration ──────────────────────────────────────────────────────────────

registerComponent<DeployedScienceConfig>({
  id: "deployed-science",
  name: "Deployed Science",
  description:
    "Power balance and per-experiment science progress for Breaking Ground deployed surface bases on every body — reported even while you fly something else. Read-only.",
  tags: ["telemetry", "science"],
  defaultSize: { w: 5, h: 9 },
  minSize: { w: 4, h: 4 },
  component: DeployedScienceComponent,
  dataRequirements: ["deployed.bases", "deployed.available"],
  defaultConfig: {},
  actions: [],
  augmentSlots: ["deployed-science.sections", "deployed-science.badges"],
  pushable: true,
});

export { DeployedScienceComponent };
