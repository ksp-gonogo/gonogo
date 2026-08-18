import type { ComponentProps } from "@ksp-gonogo/core";
import {
  AugmentSlot,
  registerAugment,
  registerComponent,
  useTelemetry,
} from "@ksp-gonogo/core";
import {
  BellIcon,
  EmptyState,
  Panel,
  VisuallyHidden,
} from "@ksp-gonogo/ui-kit";
import type { ComponentType, CSSProperties, ReactNode } from "react";
// Sections/EmptyFallbackWrap below keep styled-components for a load-bearing
// `:not(:empty) + sibling { display:none }` rule: an `:empty` pseudo-class +
// adjacent-sibling combinator inline style can't express, and the widget's
// augment-model design depends on the frame staying agnostic of which sources
// rendered content (a JS ref/MutationObserver replacement would couple them).
// biome-ignore lint/style/noRestrictedImports: :empty frame-fallback rule, no inline equivalent (see above)
import styled from "styled-components";
import {
  type ContractEntry,
  type ContractParameterAlarmTrigger,
  contractIdToSafeNumber,
  parseContracts,
} from "../ContractManager";
import { useAlarmCreator, useAlarmManager } from "../shared/AlarmsLauncher";
import { stillTrue } from "../shared/currency";

/**
 * Objectives: a read-only, in-flight-friendly view of everything you're
 * currently trying to achieve. It is the **augment-model dogfood**: the
 * widget itself is a pure *frame* (Panel +
 * `OBJECTIVES` title + one `objectives.sections` slot), and its content arrives
 * through the augment system. Active-contract parameters (`contracts.active`)
 * are the sole source, rendered as an augment satisfying the typed "objective
 * source" contract the frame publishes as the slot's props.
 *
 * Making History mission objectives (`mh.*`) were a second source here, but
 * the `mh` keyword carries no channel on the new SDK wire, contracts are the
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
  /** Parent label: the mission or contract this objective belongs to. */
  source: string;
  optional?: boolean;
  /** Set for contract parameters: enables the "alarm on completion" toggle. */
  contractId?: string;
}

// ---------------------------------------------------------------------------
// The typed "objective source" contract
//
// `objectives.sections` is the first typed-contract slot. The frame publishes,
// as the slot's props, the interface an objective-source augment must satisfy:
// a presentational `Section` component that renders a source's contributed
// `ObjectiveItem[]` plus an optional per-item alarm affordance. An augment
// "satisfies the contract" by feeding the frame's `Section` structured data,
// the frame owns all presentation so every source renders identically, and
// the slot generic enforces the shape.
// ---------------------------------------------------------------------------

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
 * The slot's props: the "objective source" contract itself. An augment bound to
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
// Frame-owned presentation: the `Section` component the slot hands to augments
// ---------------------------------------------------------------------------

/**
 * Renders one objective source's contribution: its items, or nothing when
 * empty (letting the frame's empty state show if every source is empty). The
 * frame owns this so every source: the built-in ones and any future Uplink
 * source: renders identically.
 */
function ObjectivesSection({ items, renderAlarm }: ObjectiveSection) {
  if (items.length === 0) return null;
  return (
    <ul aria-label="Objectives" style={LIST}>
      {items.map((o) => (
        <li
          key={o.id}
          style={{ ...ITEM, opacity: o.state === "pending" ? 0.6 : 1 }}
        >
          <span
            style={{ ...GLYPH, color: STATE_COLOR[o.state] }}
            aria-hidden="true"
          >
            {STATE_GLYPH[o.state]}
          </span>
          <div style={TEXT}>
            <span style={TITLE}>
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

// ---------------------------------------------------------------------------
// The built-in objective source: bound to the slot as an augment (§4.9)
// ---------------------------------------------------------------------------

/**
 * Active-contracts source. Reads `contracts.active`, maps each parameter to an
 * item, and offers the one write affordance this widget carries: a per-item
 * "warp-stop when this contract parameter completes" alarm, the same feature
 * the Contract Manager exposes. Renders nothing when no contracts are active.
 */
function ContractsObjectiveSource({ Section }: ObjectiveSourceContext) {
  // The active board is a fact and is held through a quiet link: a contract is
  // accepted, completed or failed by an EVENT, and no event reaches us down a
  // link that has stopped delivering, so the last list we were sent is still
  // what the programme is trying to achieve. Dropping it would replace a real
  // objective list with "No active objectives", which is the one sentence here
  // that makes a claim about the career rather than about the link.
  //
  // Each parameter's Complete/Failed state travels the same way, for the same
  // reason: it is an event on a record, not a quantity that decays between
  // frames. Nothing on this record is the second kind, so nothing here goes
  // through `judgeable`.
  const contractsRaw = stillTrue(useTelemetry("career.status"), undefined)
    ?.contracts?.active;
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

// The slot's props: stable reference so a re-render doesn't needlessly churn
// the mounted augments. `Section` is the frame's presentational renderer.
const OBJECTIVES_SLOT: ObjectiveSourceContext = { Section: ObjectivesSection };

function ObjectivesComponent(_: Readonly<ComponentProps<ObjectivesConfig>>) {
  return (
    <Panel panelTitle="OBJECTIVES">
      <Sections>
        <AugmentSlot name="objectives.sections" props={OBJECTIVES_SLOT} />
      </Sections>
      {/* Frame-level fallback: shown only while no bound source yields content
          (the `Sections` wrapper renders empty). CSS `:empty` keeps the frame
          agnostic of which sources exist; see the sibling rule on `Sections`. */}
      <EmptyFallbackWrap>
        <EmptyState role="status">No active objectives</EmptyState>
      </EmptyFallbackWrap>
    </Panel>
  );
}

// ── The `:empty` frame-fallback machinery (justified styled-components) ──────
// These two stay styled: the rule below is an `:empty` pseudo-class + adjacent-
// sibling combinator inline style can't express, and it's load-bearing (keeps
// the frame agnostic of which augments rendered). See the import's biome-ignore.

// Structural only: the sibling selector needs an element to target so the
// fallback hides once any source has rendered content. It used to carry
// horizontal padding too, because EmptyState's inline layout had none, but
// EmptyState now pads itself and doubling up would inset this further than
// every other widget's empty state.
const EmptyFallbackWrap = styled.div``;

const Sections = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
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

// ── Structural inline styles (everything that isn't the :empty machinery) ────
// Per-state colour is applied inline at the call site from STATE_COLOR
// (a misc-cluster widget: colours preserved, no Value-tone remap).

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
  gap: "var(--space-4)",
};

// Per-state `opacity` is applied inline at the call site.
const ITEM: CSSProperties = {
  display: "flex",
  gap: "var(--space-6)",
  alignItems: "baseline",
};

// Per-state `color` is applied inline at the call site.
const GLYPH: CSSProperties = { fontSize: "var(--font-size-xs)" };

const TEXT: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-hair)",
  minWidth: 0,
  flex: "1 1 auto",
};

// `$set` colour is applied inline at the call site.
const ALARM_BELL: CSSProperties = {
  flex: "0 0 auto",
  alignSelf: "flex-start",
  display: "inline-flex",
  padding: "var(--space-2)",
  background: "none",
  border: "none",
  cursor: "pointer",
};

const TITLE: CSSProperties = { fontSize: "var(--font-size-xs)" };

const OPTIONAL: CSSProperties = {
  color: "var(--color-text-muted)",
  fontStyle: "italic",
};

const SOURCED: CSSProperties = {
  fontSize: "var(--font-size-2xs)",
  color: "var(--color-text-muted)",
  letterSpacing: "0.03em",
};

const DESC: CSSProperties = {
  fontSize: "var(--font-size-2xs)",
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
  // Exposes one typed-contract slot; the built-in source below binds into it,
  // and any future Uplink objective source can too.
  augmentSlots: ["objectives.sections"],
  dataRequirements: ["career.status.contracts.active"],
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
