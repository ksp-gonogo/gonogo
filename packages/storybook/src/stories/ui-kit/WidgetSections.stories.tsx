import {
  createDomainAvailabilityStore,
  DomainAvailabilityContext,
  Meter,
  MeterStack,
  Panel,
  Row,
  registerAugment,
  Section,
  Tabs,
  Unit,
  WidgetMetaContext,
  WidgetSections,
} from "@ksp-gonogo/ui-kit";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactNode } from "react";
import { withGonogoFrame } from "../../frame";
import { live } from "../../readings";

/** The widget these stories mount as, so its `sections` slot is one nothing else binds. */
const WIDGET_ID = "storybook-crew-roster";

/** Two Uplinks, unaware of each other, each appending a section to the roster. */
registerAugment({
  id: "storybook-life-support-section",
  augments: `${WIDGET_ID}.sections`,
  priority: 0,
  component: () => (
    <Section title="Life support">
      <MeterStack>
        <Meter
          label="Oxygen"
          value={live("units", 412)}
          capacity={live("units", 600)}
        />
        <Meter
          label="Food"
          value={live("units", 58)}
          capacity={live("units", 200)}
          tone="warn"
        />
      </MeterStack>
    </Section>
  ),
});

registerAugment({
  id: "storybook-radiation-section",
  augments: `${WIDGET_ID}.sections`,
  priority: 1,
  requires: "radiation",
  component: () => (
    <Section title="Radiation">
      <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
        <Row>
          <Row.Name>Cabin dose rate</Row.Name>
          <Unit value={live("rad/h", 0.012)} />
        </Row>
      </ul>
    </Section>
  ),
});

/** The widget identity the dashboard provides around every tile. */
function AsWidget({ children }: { children: ReactNode }) {
  return (
    <WidgetMetaContext.Provider
      value={{ componentId: WIDGET_ID, contributionSlots: [] }}
    >
      <div style={{ width: 520, height: 420 }}>{children}</div>
    </WidgetMetaContext.Provider>
  );
}

/** A host announcing the radiation Domain, so the augment that requires it renders. */
function RadiationPresent({ children }: { children: ReactNode }) {
  const store = createDomainAvailabilityStore();
  store.setAvailable("radiation", true);
  return (
    <DomainAvailabilityContext.Provider value={store}>
      {children}
    </DomainAvailabilityContext.Provider>
  );
}

const CREW = (
  <Section key="crew" title="Crew">
    <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
      <Row>
        <Row.Name>Jebediah Kerman</Row.Name>
        <span>Pilot</span>
      </Row>
      <Row>
        <Row.Name>Valentina Kerman</Row.Name>
        <span>Pilot</span>
      </Row>
    </ul>
  </Section>
);

const meta = {
  title: "ui-kit/WidgetSections",
  component: WidgetSections,
  decorators: [
    (Story) => (
      <AsWidget>
        <Story />
      </AsWidget>
    ),
    withGonogoFrame,
  ],
} satisfies Meta<typeof WidgetSections>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The seam placed inside a tab: the Uplinks' sections render there and nowhere else in the panel. */
export const InsideATab: Story = {
  render: () => (
    <Panel panelTitle="Crew roster" panelSections={false}>
      <Tabs
        aria-label="Roster views"
        tabs={[
          { id: "crew", label: "Crew", content: CREW },
          { id: "systems", label: "Systems", content: <WidgetSections /> },
        ]}
        activeId="systems"
      />
    </Panel>
  ),
};

/** Every Domain present: both bound augments render, in priority order. */
export const AllDomainsPresent: Story = {
  render: () => (
    <RadiationPresent>
      <Panel panelTitle="Crew roster" panelSections={false}>
        {CREW}
        <WidgetSections />
      </Panel>
    </RadiationPresent>
  ),
};

/** No host has announced radiation: the augment that requires it stays out and the other still renders. */
export const DomainAbsent: Story = {
  render: () => (
    <Panel panelTitle="Crew roster" panelSections={false}>
      {CREW}
      <WidgetSections />
    </Panel>
  ),
};

/** Outside a widget there is no slot to complete, so the seam draws nothing beside the host's own section. */
export const OutsideAWidget: Story = {
  decorators: [
    (Story) => (
      <WidgetMetaContext.Provider value={null}>
        <Story />
      </WidgetMetaContext.Provider>
    ),
  ],
  render: () => (
    <Panel panelTitle="Crew roster" panelSections={false}>
      {CREW}
      <WidgetSections />
    </Panel>
  ),
};
