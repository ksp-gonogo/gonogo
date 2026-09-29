import { value } from "@ksp-gonogo/sitrep-sdk";
import { Stat, StatStrip, Unit } from "@ksp-gonogo/ui-kit";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactNode } from "react";
import { withGonogoFrame } from "../../frame";
import { absent, held, live, pending } from "../../readings";

function Column({
  width = 520,
  children,
}: {
  width?: number;
  children: ReactNode;
}) {
  return <div style={{ width }}>{children}</div>;
}

/** The headline figures of Kerbal X on its way to the Mun. */
function FlightStats() {
  return (
    <>
      <Stat label="Altitude" detail="Kerbin orbit">
        <Unit value={live("m", 84_320)} />
      </Stat>
      <Stat label="Orbital speed">
        <Unit value={live("m/s", 2_274)} />
      </Stat>
      <Stat label="Apoapsis" detail="in 12m 40s">
        <Unit value={live("m", 11_400_000)} />
      </Stat>
      <Stat label="Stage ΔV" tone="warn" detail="3 stages left">
        <Unit value={live("m/s", 860)} />
      </Stat>
    </>
  );
}

const meta = {
  title: "ui-kit/StatStrip",
  component: StatStrip,
  decorators: [
    (Story) => (
      <Column>
        <Story />
      </Column>
    ),
    withGonogoFrame,
  ],
} satisfies Meta<typeof StatStrip>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A flight's core stats, each cell the same width, figures bottom-aligned across the row. */
export const FlightReadout: Story = {
  render: () => (
    <StatStrip>
      <FlightStats />
    </StatStrip>
  ),
};

/** A narrower tile reflows the same cells onto fewer columns. */
export const Reflowed: Story = {
  decorators: [
    (Story) => (
      <Column width={280}>
        <Story />
      </Column>
    ),
  ],
  render: () => (
    <StatStrip>
      <FlightStats />
    </StatStrip>
  ),
};

/** Each tone on a figure, for status that the figure itself carries. */
export const Tones: Story = {
  render: () => (
    <StatStrip>
      <Stat label="Comms" tone="go">
        Linked
      </Stat>
      <Stat label="Signal delay" tone="info">
        <Unit value={value("s", 4.2)} />
      </Stat>
      <Stat label="Heat" tone="warn">
        <Unit value={live("K", 1_480)} />
      </Stat>
      <Stat label="Hull" tone="nogo">
        <Unit value={live("ratio", 0.18)} />
      </Stat>
      <Stat label="Crew" tone="neutral">
        3 / 3
      </Stat>
    </StatStrip>
  ),
};

/** Held, pending and absent readings keep their cell: a held mark, or the null token. */
export const Currency: Story = {
  render: () => (
    <StatStrip>
      <Stat label="Altitude">
        <Unit value={live("m", 84_320)} />
      </Stat>
      <Stat label="Mun periapsis" detail="link lost">
        <Unit value={held("m", 14_200)} />
      </Stat>
      <Stat label="Ore">
        <Unit value={pending()} />
      </Stat>
      <Stat label="Science">
        <Unit value={absent()} />
      </Stat>
    </StatStrip>
  ),
};

/** A career summary, where one long label wraps and the figures still line up. */
export const Career: Story = {
  render: () => (
    <StatStrip>
      <Stat label="Funds">
        <Unit value={live("f", 1_284_500)} />
      </Stat>
      <Stat label="Science">
        <Unit value={live("sci", 412)} />
      </Stat>
      <Stat label="Reputation earned this contract period">
        <Unit value={live("rep", 318)} />
      </Stat>
    </StatStrip>
  ),
};
