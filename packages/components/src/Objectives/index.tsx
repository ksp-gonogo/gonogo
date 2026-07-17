import type { ComponentProps } from "@ksp-gonogo/core";
import {
  AugmentSlot,
  registerAugment,
  registerComponent,
  useTelemetry,
} from "@ksp-gonogo/core";
import { BellIcon, EmptyState, Panel, PanelTitle } from "@ksp-gonogo/ui";
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
 * currently trying to achieve. It is the **augment-model dogfood**: the
 * widget itself is a pure *frame* (Panel +
 * `OBJECTIVES` title + one `objectives.sections` slot), and its content arrives
 * through the augment system. Active-contract parameters (`contracts.active`)
 * are the sole source, rendered as an augment satisfying the typed "objective
 * source" contract the frame publishes as the slot's props.
 *
 * Making History mission objectives (`mh.*`) were a second source here, but
 * the `mh` keyword carries no channel on the new SDK wire — contracts are the
 * sole objective source going forward. The frame + slot stay in place so a
 * future Uplink source (or a revived mission channel) can bind in the same
 * way; that's the point of exercising typed slot props and settings-merge
 * here rather than hardcoding a single source into the frame.
 *
 * Degrades to a muted empty state when the source yields no items, which also
 * covers no contracts being active.
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

// ---------------------------------------------------------------------------
// The typed "objective source" contract
//
// `objectives.sections` is the first typed-contract slot. The frame publishes,
// as the slot's props, the interface an objective-source augment must satisfy:
// a presentational `Section` component that renders a source's contributed
// `ObjectiveItem[]` plus an optional per-item alarm affordance. An augment
// "satisfies the contract" by feeding the frame's `Section` structured data —
// the frame owns all presentation so every source renders identically, and
// the slot generic enforces the shape.
// ---------------------------------------------------------------------------

/** One source's contribution, rendered by the frame's {@link ObjectivesSection}. */
export interface ObjectiveSection {
  /** The source's objectives — each an {@link ObjectiveItem}. */
  items: ObjectiveItem[];
  /**
   * Optional per-item alarm affordance a source may offer. Returns
   * a control for an item, or `null` for items that cannot be alarmed. The
   * contracts source supplies one.
   */
  renderAlarm?: (item: ObjectiveItem) => ReactNode;
}

/**
 * The slot's props — the "objective source" contract itself. An augment bound to
 * `objectives.sections` receives this and contributes by rendering `<Section ...>`.
 */
export interface ObjectiveSourceContext {
  Section: ComponentType<ObjectiveSection>;
}

// Declaration-merge the slot id → props type into core's `SlotRegistry` (spec
// §4.6 hybrid, declaration-merging base). This is what makes `registerAugment`
// and `<AugmentSlot name="objectives.sections" ...>` type-check `Section`-shaped
// props precisely against `ObjectiveSourceContext`, rather than the loose
// `Record<string, unknown>` fallback an unmerged slot id would get.
declare module "@ksp-gonogo/core" {
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

function contractParamState(raw: string): ObjectiveState {
  if (raw === "Complete") return "reached";
  if (raw === "Failed") return "failed";
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

// ---------------------------------------------------------------------------
// Frame-owned presentation — the `Section` component the slot hands to augments
// ---------------------------------------------------------------------------

/**
 * Renders one objective source's contribution: its items, or nothing when
 * empty (letting the frame's empty state show if every source is empty). The
 * frame owns this so every source — the built-in ones and any future Uplink
 * source — renders identically.
 */
function ObjectivesSection({ items, renderAlarm }: ObjectiveSection) {
  if (items.length === 0) return null;
  return (
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
  );
}

// ---------------------------------------------------------------------------
// The built-in objective source — bound to the slot as an augment (§4.9)
// ---------------------------------------------------------------------------

/**
 * Active-contracts source. Reads `contracts.active`, maps each parameter to an
 * item, and offers the one write affordance this widget carries: a per-item
 * "warp-stop when this contract parameter completes" alarm — the same feature
 * the Contract Manager exposes. Renders nothing when no contracts are active.
 */
function ContractsObjectiveSource({ Section }: ObjectiveSourceContext) {
  const contractsRaw = useTelemetry("career.status")?.contracts?.active;
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
    "Read-only unified list of what you're currently trying to achieve: active-contract parameters, each tagged with its source contract. Manage contracts in the Contract Manager widget.",
  tags: ["contracts", "career"],
  defaultSize: { w: 5, h: 8 },
  minSize: { w: 4, h: 3 },
  component: ObjectivesComponent,
  // Exposes one typed-contract slot; the built-in source below binds into it,
  // and any future Uplink objective source can too.
  augmentSlots: ["objectives.sections"],
  dataRequirements: ["contracts.active"],
  defaultConfig: {},
  actions: [],
  pushable: true,
});

// The built-in source binds the slot as an augment. It declares a show/hide
// setting that the host widget's settings panel merges in (§4.7); collected
// via `getAugmentSettings("objectives.sections")`.
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
