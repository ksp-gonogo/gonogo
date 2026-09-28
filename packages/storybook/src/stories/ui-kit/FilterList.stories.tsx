import { registerContribution } from "@ksp-gonogo/sitrep-sdk/spine";
import {
  ContributionsProvider,
  FilterList,
  type FilterRow,
  Row,
  RowName,
  Text,
  Unit,
  WidgetMetaContext,
} from "@ksp-gonogo/ui-kit";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactNode } from "react";
import { withGonogoFrame } from "../../frame";
import { held, live } from "../../readings";

function Column({ children }: { children: ReactNode }) {
  return <div style={{ width: 380 }}>{children}</div>;
}

/** The widget these stories pretend to mount inside, so its filters segment has terms. */
const WIDGET_ID = "storybook-filterlist-parts";

registerContribution({
  id: "storybook-filterlist-terms",
  contributes: `${WIDGET_ID}.filters`,
  compute: () => ["Converter", "Drill", "Scrubber"],
});

function part(
  id: string,
  name: string,
  searchText: string,
  detail: ReactNode,
): FilterRow {
  return {
    id,
    searchText: `${name} ${searchText}`,
    node: (
      <Row as="div">
        <RowName>{name}</RowName>
        {detail}
      </Row>
    ),
  };
}

const PARTS: FilterRow[] = [
  part(
    "isru",
    "Convert-O-Tron 250",
    "Converter LiquidFuel Oxidizer Ore",
    <Unit value={live("units", 1_260)} />,
  ),
  part(
    "drill",
    "Drill-O-Matic Mining Excavator",
    "Drill Ore",
    <Unit value={live("units", 312)} />,
  ),
  part(
    "scrubber",
    "CO2 Scrubber",
    "Scrubber Converter CarbonDioxide",
    <Unit value={held("units", 48)} />,
  ),
  part(
    "recycler",
    "Water Recycler",
    "Converter WasteWater Water",
    <Unit value={live("units", 96)} />,
  ),
  part(
    "fuel-cell",
    "Fuel Cell Array",
    "Converter ElectricCharge",
    <Text level="muted" size="sm">
      Idle
    </Text>,
  ),
];

/** Inside a widget whose providers contributed terms, so toggles sit above the search box. */
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
  title: "ui-kit/FilterList",
  component: FilterList,
  decorators: [
    (Story) => (
      <Column>
        <Story />
      </Column>
    ),
    withGonogoFrame,
  ],
  args: { rows: PARTS },
} satisfies Meta<typeof FilterList>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Parts on a mining base with contributed toggles: each toggle and the typed box narrow the rows together. */
export const WithToggles: Story = {
  render: (args) => (
    <InWidget>
      <FilterList {...args} />
    </InWidget>
  ),
};

/** Outside a widget there are no contributed terms, so only the search box narrows the rows. */
export const SearchOnly: Story = {};

/** A custom line for when the filter leaves nothing. */
export const CustomEmpty: Story = {
  args: {
    rows: [],
    emptyLabel: "No converters aboard Minmus Station",
  },
};
