import type { ComponentProps } from "@gonogo/core";
import {
  AugmentSlot,
  registerAugment,
  registerComponent,
  useDataValue,
} from "@gonogo/core";
import { BellIcon, EmptyState, Panel, PanelTitle } from "@gonogo/ui";
import type { ComponentType, ReactNode } from "react";
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
 * currently trying to achieve. It is the **augment-model dogfood** (Uplink
 * architecture spec §4.9): the widget itself is a pure *frame* (Panel +
 * `OBJECTIVES` title + one `objectives.sections` slot), and its content arrives
 * through the augment system. Two co-located sources bind that slot — Making
 * History mission objectives (`mh.*`) and active-contract parameters
 * (`contracts.active`) — each rendered as an augment satisfying the typed
 * "objective source" contract the frame publishes as the slot's props (§4.4).
 *
 * Splitting the two hardcoded sources out into augments is the whole point: it
 * exercises typed slot props, priority ordering (mission before contracts), and
 * settings-merge (§4.7) before the mechanism is applied to other widgets. The
 * sources live here in `@gonogo/components` for the P2 dogfood; re-homing them
 * into dedicated Uplink packages is a later phase.
 *
 * Degrades to a muted empty state when neither source yields items, which also
 * covers either DLC/feature being absent.
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

// ---------------------------------------------------------------------------
// The typed "objective source" contract (spec §4.4 / §4.9)
//
// `objectives.sections` is the first typed-contract slot. The frame publishes,
// as the slot's props, the interface an objective-source augment must satisfy:
// a presentational `Section` component that renders a source's contributed
// `ObjectiveItem[]` plus optional mission-header metadata and an optional
// per-item alarm affordance. An augment "satisfies the contract" by feeding the
// frame's `Section` structured data — the frame owns all presentation so every
// source renders identically, and the slot generic enforces the shape.
// ---------------------------------------------------------------------------

/** Optional mission-style header a source may render above its items. */
export interface ObjectiveHeader {
  /** Mission / source name shown in the head. */
  name: string;
  /** Current phase line, shown when there is no end-of-mission banner. */
  phase?: string;
  /** End-of-mission banner (success / failure). Takes precedence over `phase`. */
  banner?: { text: string; failed: boolean };
  /** Score readout; rendered only when `enabled`. */
  score?: MissionScore | null;
}

/** One source's contribution, rendered by the frame's {@link ObjectivesSection}. */
export interface ObjectiveSection {
  /** Optional header (missions render one; contracts do not). */
  header?: ObjectiveHeader;
  /** The source's objectives — each an {@link ObjectiveItem}. */
  items: ObjectiveItem[];
  /**
   * Optional per-item alarm affordance a source may offer (spec §4.9). Returns
   * a control for an item, or `null` for items that cannot be alarmed. The
   * contracts source supplies one; the mission source omits it.
   */
  renderAlarm?: (item: ObjectiveItem) => ReactNode;
}

/**
 * The slot's props — the "objective source" contract itself. An augment bound to
 * `objectives.sections` receives this and contributes by rendering `<Section …>`.
 */
export interface ObjectiveSourceContext {
  Section: ComponentType<ObjectiveSection>;
}

// Declaration-merge the slot id → props type into core's `SlotRegistry` (spec
// §4.6 hybrid, declaration-merging base). This is what makes `registerAugment`
// and `<AugmentSlot name="objectives.sections" …>` type-check `Section`-shaped
// props precisely against `ObjectiveSourceContext`, rather than the loose
// `Record<string, unknown>` fallback an unmerged slot id would get.
declare module "@gonogo/core" {
  interface SlotRegistry {
    "objectives.sections": ObjectiveSourceContext;
  }
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

// ---------------------------------------------------------------------------
// Frame-owned presentation — the `Section` component the slot hands to augments
// ---------------------------------------------------------------------------

/**
 * Renders one objective source's contribution: an optional mission head, then
 * the source's items (or a muted "No open objectives" when a header is present
 * but the source has no open items). The frame owns this so every source — the
 * built-in ones and any future Uplink source — renders identically.
 */
function ObjectivesSection({ header, items, renderAlarm }: ObjectiveSection) {
  return (
    <>
      {header && (
        <MissionHead>
          <MissionName>{header.name}</MissionName>
          {header.banner ? (
            <Banner
              $failed={header.banner.failed}
              role={header.banner.failed ? "alert" : "status"}
              aria-live={header.banner.failed ? "assertive" : "polite"}
            >
              {header.banner.text}
            </Banner>
          ) : (
            header.phase && <Phase>{header.phase}</Phase>
          )}
          {header.score?.enabled && (
            <Score>
              Score <strong>{Math.round(header.score.current)}</strong>
              <ScoreMax> / {Math.round(header.score.max)}</ScoreMax>
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
              {renderAlarm?.(o)}
            </Item>
          ))}
        </List>
      ) : (
        // Only when this source has a header (a running mission with no open
        // objectives of its own). A headerless source with no items renders
        // nothing, letting the frame's empty state show if every source is empty.
        header && <Muted role="status">No open objectives</Muted>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// The two built-in objective sources — bound to the slot as augments (§4.9)
// ---------------------------------------------------------------------------

/**
 * Making History mission source. Reads `mh.*` and, while a mission is available,
 * renders the mission head (name / phase / score / end banner) and its
 * objectives. Availability is read from the widget's own data source in-body
 * rather than via the augment `requires` Domain gate: `requires` reads the
 * `<domain>.available` Topic off the streaming store, but `mh.available` still
 * flows through the legacy `"data"` source here, so the in-body read is what
 * matches the widget's data path (and preserves its behaviour).
 */
function MissionObjectiveSource({ Section }: ObjectiveSourceContext) {
  const missionAvailable = useDataValue<boolean>("data", "mh.available");
  const missionName = useDataValue<string>("data", "mh.name");
  const phase = useDataValue<string>("data", "mh.phase");
  const scoreRaw = useDataValue("data", "mh.score");
  const finished = useDataValue<boolean>("data", "mh.finished");
  const outcome = useDataValue<string>("data", "mh.outcome");
  const objectivesRaw = useDataValue("data", "mh.objectives");

  if (missionAvailable !== true) return null;

  const items = missionObjectives(objectivesRaw, missionName ?? "Mission");
  const ended = finished === true;
  const failed = outcome === "fail";
  const header: ObjectiveHeader = {
    name: missionName || "Mission",
    phase,
    score: parseScore(scoreRaw),
    banner: ended
      ? { text: failed ? "MISSION FAILED" : "MISSION SUCCESS", failed }
      : undefined,
  };

  return <Section header={header} items={items} />;
}

/**
 * Active-contracts source. Reads `contracts.active`, maps each parameter to an
 * item, and offers the one write affordance this widget carries: a per-item
 * "warp-stop when this contract parameter completes" alarm — the same feature
 * the Contract Manager exposes. Renders nothing when no contracts are active.
 */
function ContractsObjectiveSource({ Section }: ObjectiveSourceContext) {
  const contractsRaw = useDataValue("data", "contracts.active");
  const createAlarm = useAlarmCreator<ContractParameterAlarmTrigger>();
  const alarmManager = useAlarmManager();

  const items = contractObjectives(parseContracts(contractsRaw) ?? []);
  if (items.length === 0) return null;

  // Bell toggle for an Incomplete contract parameter. Null for everything that
  // can't be alarmed (missing provider, non-numeric id, already-complete).
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

  return <Section items={items} renderAlarm={renderAlarm} />;
}

// The slot's props — stable reference so a re-render doesn't needlessly churn
// the mounted augments. `Section` is the frame's presentational renderer.
const OBJECTIVES_SLOT: ObjectiveSourceContext = { Section: ObjectivesSection };

function ObjectivesComponent(_: Readonly<ComponentProps<ObjectivesConfig>>) {
  return (
    <Panel>
      <PanelTitle>OBJECTIVES</PanelTitle>
      <Sections>
        <AugmentSlot name="objectives.sections" props={OBJECTIVES_SLOT} />
      </Sections>
      {/* Frame-level fallback: shown only while no bound source yields content
          (the `Sections` wrapper renders empty). CSS `:empty` keeps the frame
          agnostic of which sources exist — see the sibling rule on `Sections`. */}
      <EmptyFallback role="status">No active objectives</EmptyFallback>
    </Panel>
  );
}

const EmptyFallback = styled(EmptyState)``;

const Sections = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 4px 8px 8px;
  overflow: auto;

  /* When any source has rendered content, hide the frame's empty fallback. When
     every source renders nothing, this wrapper is genuinely empty (augments
     that return null add no DOM), the rule doesn't apply, and the fallback shows. */
  &:not(:empty) + ${EmptyFallback} {
    display: none;
  }
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
  // Exposes one typed-contract slot; the built-in sources below bind into it,
  // and any future Uplink objective source can too (spec §4.6).
  augmentSlots: ["objectives.sections"],
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

// The two built-in sources bind the slot as augments. Mission renders before
// contracts (ascending priority — spec §4.2/§4.8). Each declares a per-source
// show/hide setting that the host widget's settings panel merges in (§4.7);
// they are collected via `getAugmentSettings("objectives.sections")`.
registerAugment({
  id: "objectives-mission",
  augments: "objectives.sections",
  component: MissionObjectiveSource,
  // No `channels`: `mh.*` is not (yet) a migrated Topic — it still flows through
  // the legacy `"data"` source, read in-body via `useDataValue`.
  priority: 10,
  settings: [
    {
      key: "show",
      type: "boolean",
      label: "Show mission objectives",
      default: true,
    },
  ],
});

registerAugment({
  id: "objectives-contracts",
  augments: "objectives.sections",
  component: ContractsObjectiveSource,
  // `contracts.active` is carried by the `career.status` Topic (see the stream
  // dual-run tests); the legacy key is mapped onto it by the migration shim.
  channels: ["career.status"],
  priority: 20,
  settings: [
    {
      key: "show",
      type: "boolean",
      label: "Show contract objectives",
      default: true,
    },
  ],
});

export { ObjectivesComponent, ObjectivesSection };
