import { type MeterEntry, value } from "@ksp-gonogo/sitrep-sdk";
import {
  ContributionsPanelStore,
  Row,
  Section,
  Stack,
  WidgetMetaContext,
  WidgetMeters,
} from "@ksp-gonogo/ui-kit";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactNode } from "react";
import { withGonogoFrame } from "../../frame";
import { held, live } from "../../readings";

/** The widget these stories mount as; its `meters` slot is what the entries below fill. */
const WIDGET_ID = "storybook-crew-status";

/**
 * Fills the widget's contribution store directly, standing in for the per-frame
 * aggregation that writes it from each Uplink's contributions.
 */
function WithMeters({
  entries,
  children,
}: {
  entries: readonly MeterEntry[];
  children: ReactNode;
}) {
  return (
    <WidgetMetaContext.Provider
      value={{ componentId: WIDGET_ID, contributionSlots: [] }}
    >
      <ContributionsPanelStore.Provider>
        <Seed entries={entries}>{children}</Seed>
      </ContributionsPanelStore.Provider>
    </WidgetMetaContext.Provider>
  );
}

function Seed({
  entries,
  children,
}: {
  entries: readonly MeterEntry[];
  children: ReactNode;
}) {
  const store = ContributionsPanelStore.useStore();
  if (store && store.getSnapshot().length === 0) {
    store.register({ id: `${WIDGET_ID}.meters`, entries });
  }
  return <>{children}</>;
}

const JEB_DOSE: MeterEntry = {
  id: "jeb:radiation",
  label: "Radiation dose",
  value: live("ratio", 0.39, { lo: 0.36, hi: 0.42, kind: "sigma1" }),
  tone: "warn",
  row: "Jebediah Kerman",
};
const JEB_STRESS: MeterEntry = {
  id: "jeb:stress",
  label: "Stress",
  value: value("ratio", 0.12),
  tone: "go",
  valueLabel: "Calm",
  row: "Jebediah Kerman",
};
const BILL_DOSE: MeterEntry = {
  id: "bill:radiation",
  label: "Radiation dose",
  value: held("ratio", 0.71),
  tone: "nogo",
  row: "Bill Kerman",
};
const SHIELDING: MeterEntry = {
  id: "shielding",
  label: "Cabin shielding",
  value: value("ratio", 0.84),
  tone: "info",
};
const HABITAT: MeterEntry = {
  id: "habitat",
  label: "Living space",
  value: value("ratio", 0.55),
  valueLabel: "4 of 7 m³ each",
};

const ALL = [JEB_DOSE, JEB_STRESS, BILL_DOSE, SHIELDING, HABITAT];

const meta = {
  title: "ui-kit/WidgetMeters",
  component: WidgetMeters,
  decorators: [
    (Story) => (
      <div style={{ width: 360 }}>
        <Story />
      </div>
    ),
    withGonogoFrame,
  ],
} satisfies Meta<typeof WidgetMeters>;

export default meta;
type Story = StoryObj<typeof meta>;

/** One stack per crew row, each showing only the meters addressed at that kerbal. */
export const PerRow: Story = {
  render: () => (
    <WithMeters entries={ALL}>
      <Section title="Crew">
        <Stack gap="related">
          {["Jebediah Kerman", "Bill Kerman", "Bob Kerman"].map((name) => (
            <div key={name}>
              <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
                <Row>
                  <Row.Name>{name}</Row.Name>
                </Row>
              </ul>
              <WidgetMeters row={name} />
            </div>
          ))}
        </Stack>
      </Section>
    </WithMeters>
  ),
};

/** The whole-widget stack: only the vessel-wide entries, never a row's. */
export const VesselWide: Story = {
  render: () => (
    <WithMeters entries={ALL}>
      <WidgetMeters />
    </WithMeters>
  ),
};

/** A banded reading and a held one, drawn the same way whichever Uplink sent them. */
export const BandedAndHeld: Story = {
  render: () => (
    <WithMeters entries={ALL}>
      <Stack gap="related">
        <WidgetMeters row="Jebediah Kerman" />
        <WidgetMeters row="Bill Kerman" />
      </Stack>
    </WithMeters>
  ),
};

/** Nothing contributed: the stack draws nothing, so only the host's own row shows. */
export const NothingContributed: Story = {
  render: () => (
    <WithMeters entries={[]}>
      <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
        <Row>
          <Row.Name>Valentina Kerman</Row.Name>
        </Row>
      </ul>
      <WidgetMeters row="Valentina Kerman" />
    </WithMeters>
  ),
};
