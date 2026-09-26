import type { ComponentType, ReactNode } from "react";

export type ObjectivesConfig = Record<string, never>;

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
