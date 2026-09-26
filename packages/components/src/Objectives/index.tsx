import type { ComponentProps } from "@ksp-gonogo/core";
import {
  AugmentSlot,
  registerAugment,
  registerComponent,
} from "@ksp-gonogo/core";
import { EmptyState, Panel, Section } from "@ksp-gonogo/ui-kit";
// The `:not(:empty) + sibling` fallback rule below keeps the frame agnostic of which augments rendered, and no inline style can express it.
// biome-ignore lint/style/noRestrictedImports: :empty frame-fallback rule, no inline equivalent (see above)
import styled from "styled-components";
import { ContractsObjectiveSource, topics } from "./ContractsObjectiveSource";
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
  gap: var(--gap-section);

  /* Augments that return null add no DOM, so an empty wrapper means no source rendered and the fallback shows. */
  &:not(:empty) + ${EmptyFallbackWrap} {
    display: none;
  }
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
