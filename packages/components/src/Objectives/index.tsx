import type { ComponentProps } from "@ksp-gonogo/core";
import {
  AugmentSlot,
  registerAugment,
  registerComponent,
} from "@ksp-gonogo/core";
import { AutoEmptyState, EmptyState, Panel, Section } from "@ksp-gonogo/ui-kit";
import {
  ContractsObjectiveSource,
  contractsTopics,
} from "./ContractsObjectiveSource";
import { ObjectivesSection } from "./ObjectivesSection";
import type { ObjectiveSourceContext, ObjectivesConfig } from "./types";

export { contractObjectives } from "./ContractsObjectiveSource";
export type {
  ObjectiveItem,
  ObjectiveSection,
  ObjectiveSourceContext,
  ObjectiveState,
} from "./types";

// A stable reference, so a re-render does not churn the mounted augments.
const OBJECTIVES_SLOT: ObjectiveSourceContext = { Section: ObjectivesSection };

/**
 * Objectives is a pure frame: a Panel and one `objectives.source` slot, with all content arriving through augments.
 * The built-in source is active-contract parameters, and any Uplink source binds the same way.
 */
function ObjectivesComponent(_: Readonly<ComponentProps<ObjectivesConfig>>) {
  return (
    <Panel
      panelTitle="OBJECTIVES"
      sections={
        <Section full>
          <AutoEmptyState
            gap="section"
            fallback={
              <EmptyState role="status">No active objectives</EmptyState>
            }
          >
            <AugmentSlot name="objectives.source" props={OBJECTIVES_SLOT} />
          </AutoEmptyState>
        </Section>
      }
    />
  );
}

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
  channels: contractsTopics.channels,
  fields: contractsTopics.fields,
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
