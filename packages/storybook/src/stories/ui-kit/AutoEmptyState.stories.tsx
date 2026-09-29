import {
  AugmentSlot,
  AutoEmptyState,
  createDomainAvailabilityStore,
  DomainAvailabilityContext,
  EmptyState,
  Panel,
  Row,
  registerAugment,
  WidgetMetaContext,
} from "@ksp-gonogo/ui-kit";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactNode } from "react";
import { withGonogoFrame } from "../../frame";

/** The widget these stories mount as; only they bind its `sections` slot, filled by Uplinks the frame cannot see into. */
const WIDGET_ID = "storybook-science-archive";
const SLOT = `${WIDGET_ID}.sections`;

const NO_PROPS: Record<string, never> = {};

registerAugment({
  id: "storybook-survey-experiment",
  augments: SLOT,
  requires: "surveymod",
  component: () => (
    <Row as="div">
      <Row.Name>Survey mod altimetry: Mun, 62% mapped</Row.Name>
    </Row>
  ),
});

registerAugment({
  id: "storybook-dmagic-experiment",
  augments: SLOT,
  requires: "dmagic",
  component: () => (
    <Row as="div">
      <Row.Name>DMagic magnetometer: Kerbin high orbit</Row.Name>
    </Row>
  ),
});

/** Inside the widget, on a host that has announced the given Domains, so augments requiring them render. */
function Present({
  domains,
  children,
}: {
  domains: readonly string[];
  children: ReactNode;
}) {
  const store = createDomainAvailabilityStore();
  for (const domain of domains) store.setAvailable(domain, true);
  return (
    <WidgetMetaContext.Provider
      value={{ componentId: WIDGET_ID, contributionSlots: [] }}
    >
      <DomainAvailabilityContext.Provider value={store}>
        {children}
      </DomainAvailabilityContext.Provider>
    </WidgetMetaContext.Provider>
  );
}

function Tile({ children }: { children: ReactNode }) {
  return <div style={{ width: 360, height: 220 }}>{children}</div>;
}

const FALLBACK = <EmptyState>No experiment Uplinks running</EmptyState>;

const meta = {
  title: "ui-kit/AutoEmptyState",
  component: AutoEmptyState,
  decorators: [
    (Story) => (
      <Tile>
        <Story />
      </Tile>
    ),
    withGonogoFrame,
  ],
  args: { fallback: FALLBACK },
} satisfies Meta<typeof AutoEmptyState>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Two Uplinks bound and both running: their rows render and the fallback hides itself. */
export const AugmentsRendered: Story = {
  render: (args) => (
    <Present domains={["surveymod", "dmagic"]}>
      <Panel
        panelTitle="Science archive"
        panelSections={false}
        sections={
          <AutoEmptyState {...args}>
            <AugmentSlot segment="sections" props={NO_PROPS} />
          </AutoEmptyState>
        }
      />
    </Present>
  ),
};

/** Augments bound, but neither mod is running, so each renders nothing and the fallback shows. */
export const EveryAugmentEmpty: Story = {
  render: (args) => (
    <Present domains={[]}>
      <Panel
        panelTitle="Science archive"
        panelSections={false}
        sections={
          <AutoEmptyState {...args}>
            <AugmentSlot segment="sections" props={NO_PROPS} />
          </AutoEmptyState>
        }
      />
    </Present>
  ),
};

/** Only one mod running: its row alone, still no fallback. */
export const OneOfTwo: Story = {
  render: (args) => (
    <Present domains={["surveymod"]}>
      <Panel
        panelTitle="Science archive"
        panelSections={false}
        sections={
          <AutoEmptyState {...args}>
            <AugmentSlot segment="sections" props={NO_PROPS} />
          </AutoEmptyState>
        }
      />
    </Present>
  ),
};

/** Plain children rather than a slot: anything rendered hides the fallback. */
export const PlainChildren: Story = {
  args: {
    children: (
      <>
        <Row as="div">
          <Row.Name>Crew report: Mun surface</Row.Name>
        </Row>
        <Row as="div">
          <Row.Name>EVA report: Minmus flats</Row.Name>
        </Row>
      </>
    ),
  },
};
