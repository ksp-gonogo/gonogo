import type { ComponentProps } from "@ksp-gonogo/core";
import {
  AugmentSlot,
  defineTopicManifest,
  registerAugment,
  registerComponent,
} from "@ksp-gonogo/core";
import { stillTrue } from "@ksp-gonogo/sitrep-sdk";

import {
  BellIcon,
  EmptyState,
  Panel,
  Section,
  VisuallyHidden,
} from "@ksp-gonogo/ui-kit";
import type { ComponentType, CSSProperties, ReactNode } from "react";
// The `:not(:empty) + sibling` fallback rule below keeps the frame agnostic of which augments rendered, and no inline style can express it.
// biome-ignore lint/style/noRestrictedImports: :empty frame-fallback rule, no inline equivalent (see above)
import styled from "styled-components";
import {
  type ContractEntry,
  type ContractParameterAlarmTrigger,
  type ContractParameterState,
  contractIdToSafeNumber,
  parseContracts,
} from "../ContractManager";
import { useAlarmCreator, useAlarmManager } from "../shared/AlarmsLauncher";

const topics = defineTopicManifest({
  channels: ["career.status"],
  fields: ["career.status.contracts.active"],
});

/**
 * Objectives is a pure frame: a Panel and one `objectives.source` slot, with all content arriving through augments.
 * The built-in source is active-contract parameters, and any Uplink source binds the same way.
 */

type ObjectivesConfig = Record<string, never>;

export type ObjectiveState = "pending" | "active" | "reached" | "failed";

export interface ObjectiveItem {
  id: string;
  title: string;
  description?: string;
  state: ObjectiveState;
  /** Parent label: the mission or contract this objective belongs to. */
  source: string;
  optional?: boolean;
  /** Set for contract parameters: enables the "alarm on completion" toggle. */
  contractId?: string;
}

/** One source's contribution, rendered by the frame's {@link ObjectivesSection}. */
export interface ObjectiveSection {
  /** The source's objectives: each an {@link ObjectiveItem}. */
  items: ObjectiveItem[];
  /**
   * Optional per-item alarm affordance a source may offer. Returns
   * a control for an item, or `null` for items that cannot be alarmed. The
   * contracts source supplies one.
   */
  renderAlarm?: (item: ObjectiveItem) => ReactNode;
}

/**
 * The slot's props. An augment bound to `objectives.source` contributes by rendering `<Section ...>`, so the frame owns all presentation.
 */
export interface ObjectiveSourceContext {
  Section: ComponentType<ObjectiveSection>;
}

/*
 * No `declare module` block here: the sdk's mirror in `api/slots.ts` declares this key on the same `SlotRegistry`.
 * Its props are component-valued, so a second declaration fails with TS2717 rather than merging.
 */

const STATE_GLYPH: Record<ObjectiveState, string> = {
  pending: "○",
  active: "◐",
  reached: "●",
  failed: "✕",
};

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

/** Renders one source's items, or nothing when empty so the frame's fallback can show. */
function ObjectivesSection({ items, renderAlarm }: ObjectiveSection) {
  if (items.length === 0) return null;
  return (
    <ul aria-label="Objectives" style={LIST}>
      {items.map((o) => (
        <li key={o.id} style={ITEM}>
          <span
            style={{ ...GLYPH, color: STATE_COLOR[o.state] }}
            aria-hidden="true"
          >
            {STATE_GLYPH[o.state]}
          </span>
          <div style={TEXT}>
            <span
              style={
                o.state === "pending"
                  ? { ...TITLE, color: "var(--color-text-muted)" }
                  : TITLE
              }
            >
              {o.title}
              {o.optional && <span style={OPTIONAL}> (optional)</span>}
            </span>
            <span style={SOURCED}>{o.source}</span>
            {o.description && <span style={DESC}>{o.description}</span>}
          </div>
          <VisuallyHidden>{o.state}</VisuallyHidden>
          {renderAlarm?.(o)}
        </li>
      ))}
    </ul>
  );
}

/** The active-contracts source, with a per-item alarm on parameter completion. */
function ContractsObjectiveSource({ Section }: ObjectiveSourceContext) {
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

// A stable reference, so a re-render does not churn the mounted augments.
const OBJECTIVES_SLOT: ObjectiveSourceContext = { Section: ObjectivesSection };

function ObjectivesComponent(_: Readonly<ComponentProps<ObjectivesConfig>>) {
  return (
    <Panel
      panelTitle="OBJECTIVES"
      /* One section holding both: the fallback is hidden by an adjacent-sibling rule that a wrapper between them would break. */
      sections={
        <Section full>
          <Sections>
            <AugmentSlot name="objectives.source" props={OBJECTIVES_SLOT} />
          </Sections>
          <EmptyFallbackWrap>
            <EmptyState role="status">No active objectives</EmptyState>
          </EmptyFallbackWrap>
        </Section>
      }
    />
  );
}

// The sibling selector's target.
const EmptyFallbackWrap = styled.div``;

const Sections = styled.div`
  display: flex;
  flex-direction: column;
  /* Each child is a whole contributed section from a different source, which
     is what --gap-section names; the rhythm inside one is LIST's below. */
  gap: var(--gap-section);
  /* No inset and no scrolling of its own: Panel.Body owns both now, and
     keeping this one's padding would inset the sections further than the
     title above them. */

  /* When any source has rendered content, hide the frame's empty fallback. When
     every source renders nothing, this wrapper is genuinely empty (augments
     that return null add no DOM), the rule doesn't apply, and the fallback shows. */
  &:not(:empty) + ${EmptyFallbackWrap} {
    display: none;
  }
`;

const STATE_COLOR: Record<ObjectiveState, string> = {
  pending: "var(--color-text-muted)",
  active: "var(--color-status-go-fg)",
  reached: "var(--color-status-go-fg)",
  failed: "var(--color-status-nogo-fg)",
};

const LIST: CSSProperties = {
  listStyle: "none",
  margin: 0,
  padding: 0,
  display: "flex",
  flexDirection: "column",
  gap: "var(--gap-related)",
};

const ITEM: CSSProperties = {
  display: "flex",
  gap: "var(--gap-related)",
  alignItems: "baseline",
};

const GLYPH: CSSProperties = { fontSize: "var(--font-size-xs)" };

const TEXT: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--gap-line)",
  minWidth: 0,
  flex: "1 1 auto",
};

const ALARM_BELL: CSSProperties = {
  flex: "0 0 auto",
  alignSelf: "flex-start",
  display: "inline-flex",
  padding: "var(--inset-icon-button-tight)",
  background: "none",
  border: "none",
  cursor: "pointer",
};

const TITLE: CSSProperties = { fontSize: "var(--font-size-value)" };

const OPTIONAL: CSSProperties = {
  color: "var(--color-text-muted)",
  fontStyle: "italic",
};

const SOURCED: CSSProperties = {
  fontSize: "var(--font-size-caption)",
  color: "var(--color-text-muted)",
  letterSpacing: "0.03em",
};

const DESC: CSSProperties = {
  fontSize: "var(--font-size-compact)",
  color: "var(--color-text-muted)",
};

registerComponent<ObjectivesConfig>({
  id: "objectives",
  name: "Objectives",
  description:
    "Read-only unified list of what you're currently trying to achieve: active-contract parameters, each tagged with its source contract. Manage contracts in the Contract Manager widget.",
  tags: ["contracts", "career"],
  defaultSize: { w: 5, h: 8 },
  minSize: { w: 4, h: 3 },
  component: ObjectivesComponent,
  augmentSlots: ["objectives.source"],
  channels: topics.channels,
  fields: topics.fields,
  defaultConfig: {},
  actions: [],
  pushable: true,
});

// The show/hide setting merges into the host widget's settings panel.
registerAugment({
  id: "objectives-contracts",
  augments: "objectives.source",
  component: ContractsObjectiveSource,
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
