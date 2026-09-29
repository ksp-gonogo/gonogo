import type { Reading, Value } from "@ksp-gonogo/sitrep-sdk";
import { registerContribution } from "@ksp-gonogo/sitrep-sdk/spine";
import {
  ContributionsProvider,
  EmptyState,
  FilterRegion,
  Row,
  RowName,
  Unit,
  useRowFilter,
  WidgetMetaContext,
} from "@ksp-gonogo/ui-kit";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactNode } from "react";
import { withGonogoFrame } from "../../frame";
import { held, live } from "../../readings";

/** The widget these stories pretend to mount inside, so its filters segment has terms. */
const WIDGET_ID = "storybook-filterregion-vessels";

registerContribution({
  id: "storybook-filterregion-terms",
  contributes: `${WIDGET_ID}.filters`,
  compute: () => ["Lander", "Station", "Probe"],
});

interface Vessel {
  name: string;
  kind: string;
  altitude: Reading<Value<"m">>;
}

const VESSELS: Vessel[] = [
  { name: "Mun Lander II", kind: "Lander", altitude: live("m", 12_480) },
  { name: "Kerbin Station", kind: "Station", altitude: live("m", 212_000) },
  { name: "Minmus Relay", kind: "Probe", altitude: held("m", 460_300) },
  { name: "Duna Scout", kind: "Probe", altitude: live("m", 1_240_000) },
  { name: "Ike Lander", kind: "Lander", altitude: held("m", 3_150) },
];

/**
 * A host that draws its own rows and narrows them with `useRowFilter`, the
 * shape a table takes when it cannot hand its rows to `FilterList`.
 */
function VesselList({ fill = false }: { fill?: boolean }) {
  const filter = useRowFilter({ label: "Search vessels" });
  const shown = VESSELS.filter((v) => filter.matches(`${v.name} ${v.kind}`));
  return (
    <FilterRegion filter={filter} fill={fill}>
      {shown.length === 0 ? (
        <EmptyState>
          {filter.active ? "No vessel matches" : "No vessels"}
        </EmptyState>
      ) : (
        <ul
          style={{
            listStyle: "none",
            margin: 0,
            padding: 0,
            ...(fill ? { flex: 1, minHeight: 0, overflowY: "auto" } : {}),
          }}
        >
          {shown.map((v) => (
            <Row key={v.name}>
              <RowName>{v.name}</RowName>
              <Unit value={v.altitude} />
            </Row>
          ))}
        </ul>
      )}
    </FilterRegion>
  );
}

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
  title: "ui-kit/FilterRegion",
  component: FilterRegion,
  decorators: [
    (Story) => (
      <div style={{ width: 380 }}>
        <Story />
      </div>
    ),
    withGonogoFrame,
  ],
} satisfies Meta<typeof FilterRegion>;

export default meta;
type Story = StoryObj<typeof FilterRegion>;

/** Contributed toggles and the search box above the host's own rows; both narrow the list together. */
export const WithToggles: Story = {
  render: () => (
    <InWidget>
      <VesselList />
    </InWidget>
  ),
};

/** Outside a widget there are no contributed terms, so the control is the search box alone. */
export const SearchOnly: Story = {
  render: () => <VesselList />,
};

/** With `fill`, the region takes the height its bordered column leaves: the control stays put and the list scrolls under it. */
export const Fill: Story = {
  render: () => (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: 150,
        padding: "var(--inset-popover)",
        border: "1px solid var(--color-border-subtle)",
      }}
    >
      <InWidget>
        <VesselList fill />
      </InWidget>
    </div>
  ),
};
