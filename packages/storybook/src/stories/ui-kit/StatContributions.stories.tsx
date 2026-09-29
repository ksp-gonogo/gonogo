import { type StatEntry, value } from "@ksp-gonogo/sitrep-sdk";
import {
  ContributionsPanelStore,
  Stat,
  StatContributions,
  StatStrip,
  Unit,
} from "@ksp-gonogo/ui-kit";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { type ReactNode, useLayoutEffect } from "react";
import { withGonogoFrame } from "../../frame";
import { live } from "../../readings";

const SLOT = "astronaut-complex.readouts";

function Column({ children }: { children: ReactNode }) {
  return <div style={{ width: 560 }}>{children}</div>;
}

/** Writes entries into the enclosing panel's contribution store, as the host's aggregation does from each Uplink. */
function Contributed({
  slot,
  entries,
}: {
  slot: string;
  entries: readonly StatEntry[];
}) {
  const store = ContributionsPanelStore.useStore();
  useLayoutEffect(
    () => store?.register({ id: slot, entries }),
    [store, slot, entries],
  );
  return null;
}

/** The Astronaut Complex's own stats, with Uplink contributions landing in the same strip. */
function Complex({ entries }: { entries: readonly StatEntry[] }) {
  return (
    <ContributionsPanelStore.Provider>
      <Contributed slot={SLOT} entries={entries} />
      <StatStrip>
        <Stat label="Roster">7 / 13</Stat>
        <Stat label="Hire price">
          <Unit value={live("f", 62_400)} />
        </Stat>
        <StatContributions slot={SLOT} />
      </StatStrip>
    </ContributionsPanelStore.Provider>
  );
}

const PLANTED_ENTRIES: readonly StatEntry[] = [
  {
    id: "planted.training",
    label: "In training",
    text: "2 kerbals",
    detail: "Valentina done in 14d",
  },
  {
    id: "planted.upkeep",
    label: "Crew upkeep",
    value: value("f/day", 4_100),
    tone: "warn",
  },
];

const meta = {
  title: "ui-kit/StatContributions",
  component: StatContributions,
  decorators: [
    (Story) => (
      <Column>
        <Story />
      </Column>
    ),
    withGonogoFrame,
  ],
  args: { slot: SLOT },
} satisfies Meta<typeof StatContributions>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Two contributed stats drawn as cells of the host's strip, after its own two. */
export const IntoHostStrip: Story = {
  render: () => <Complex entries={PLANTED_ENTRIES} />,
};

/** Every figure form an entry can carry: a quantity, text, a null reading, and neither. */
export const FigureForms: Story = {
  render: () => (
    <Complex
      entries={[
        {
          id: "k.dose",
          label: "Peak dose",
          value: value("ratio", 0.39),
          tone: "warn",
          detail: "Bill Kerman",
        },
        { id: "k.flights", label: "Flights logged", text: "41" },
        { id: "k.eva", label: "EVA time", value: null },
        { id: "k.nothing", label: "Morale" },
      ]}
    />
  ),
};

/** Each tone an entry may name, drawn as the host's own Stat draws it. */
export const Tones: Story = {
  render: () => (
    <Complex
      entries={(["go", "info", "warn", "nogo"] as const).map((tone) => ({
        id: `tone.${tone}`,
        label: `Tone ${tone}`,
        value: value("f/day", 1_200),
        tone,
      }))}
    />
  ),
};

/** Nothing contributed: the component draws nothing and the host's own cells fill the strip. */
export const NothingContributed: Story = {
  render: () => <Complex entries={[]} />,
};
