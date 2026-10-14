import { value } from "@ksp-gonogo/sitrep-sdk";
import { registerContribution } from "@ksp-gonogo/sitrep-sdk/spine";
import {
  type ContributedEntries,
  Contribution,
  ContributionsProvider,
  Meter,
  MeterStack,
  Stack,
  Text,
  WidgetMetaContext,
} from "@ksp-gonogo/ui-kit";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactNode } from "react";
import { withGonogoFrame } from "../../frame";

/** The widget these stories pretend to mount inside, so its `meters` slot has entries. */
const WIDGET_ID = "storybook-contribution-crew";

registerContribution({
  id: "storybook-contribution-meters",
  contributes: `${WIDGET_ID}.meters`,
  compute: () => [
    {
      id: "radiation",
      label: "Radiation dose",
      value: value("ratio", 0.62),
      tone: "warn" as const,
      row: "Valentina Kerman",
    },
    {
      id: "oxygen",
      label: "Oxygen",
      value: value("ratio", 0.91),
      row: "Valentina Kerman",
    },
    {
      id: "stress",
      label: "Stress",
      value: value("ratio", 0.3),
      row: "Bill Kerman",
    },
    {
      id: "battery",
      label: "Battery",
      value: value("ratio", 0.55),
    },
  ],
});

/** A list of meters: what a slot of meter entries is drawn by. */
function MeterList({ entries }: ContributedEntries<"meters">) {
  return (
    <MeterStack role="group" aria-label="meters">
      {entries.map((entry) => (
        <Meter
          key={entry.id}
          label={entry.label}
          value={entry.value}
          tone={entry.tone}
          valueLabel={entry.valueLabel}
        />
      ))}
    </MeterStack>
  );
}

/** Inside a widget whose slot Uplinks have contributed to, as the dashboard mounts one. */
function InWidget({ children }: { children: ReactNode }) {
  return (
    <WidgetMetaContext.Provider
      value={{ componentId: WIDGET_ID, contributionSlots: [] }}
    >
      <ContributionsProvider>{children}</ContributionsProvider>
    </WidgetMetaContext.Provider>
  );
}

const meta = {
  title: "ui-kit/Contribution",
  component: Contribution,
  decorators: [
    (Story) => (
      <div style={{ width: 360 }}>
        <Story />
      </div>
    ),
    withGonogoFrame,
  ],
} satisfies Meta<typeof Contribution>;

export default meta;
type Story = StoryObj<typeof Contribution>;

/** Every entry contributed to the widget's `meters` slot, each drawn as a `Meter` inside the group. */
export const AllEntries: Story = {
  render: () => (
    <InWidget>
      <Contribution slot="meters" component={MeterList} />
    </InWidget>
  ),
};

/** A roster row asking only for the entries addressed to it, as the crew status widget does for each kerbal. */
export const ForOneRow: Story = {
  render: () => (
    <InWidget>
      <Stack gap="related">
        {["Valentina Kerman", "Bill Kerman", "Jebediah Kerman"].map((name) => (
          <Stack key={name} gap="related-dense">
            <Text>{name}</Text>
            <Contribution
              slot="meters"
              component={MeterList}
              filter={(entry) => entry.row === name}
            />
          </Stack>
        ))}
      </Stack>
    </InWidget>
  ),
};

/** Entries about the whole widget, which name no row. */
export const WholeWidget: Story = {
  render: () => (
    <InWidget>
      <Contribution
        slot="meters"
        component={MeterList}
        filter={(entry) => entry.row === undefined}
      />
    </InWidget>
  ),
};
