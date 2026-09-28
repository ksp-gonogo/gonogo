import { Fill, GraphNotice, Notice, Stack, Text } from "@ksp-gonogo/ui-kit";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactNode } from "react";
import { withGonogoFrame } from "../../frame";

/** A fixed tile, the size a dashboard grid cell would hand the widget, outlined so its edge shows. */
function Tile({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        width: 360,
        height: 220,
        display: "flex",
        flexDirection: "column",
        border: "1px dashed var(--color-border-subtle)",
      }}
    >
      {children}
    </div>
  );
}

/** An ascent profile stretched to whatever box it is given, standing in for a graph. */
function AscentTrace() {
  return (
    <svg
      viewBox="0 0 100 60"
      preserveAspectRatio="none"
      style={{ flex: 1, width: "100%", minHeight: 0 }}
      role="img"
      aria-label="Altitude over the first four minutes of ascent"
    >
      <rect
        x="0"
        y="0"
        width="100"
        height="60"
        fill="var(--color-surface-sunken)"
      />
      <path
        d="M0 58 C 20 56, 35 44, 50 30 S 80 8, 100 5"
        fill="none"
        stroke="var(--color-accent-fg)"
        strokeWidth="1.2"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

const meta = {
  title: "ui-kit/Fill",
  component: Fill,
  decorators: [
    (Story) => (
      <Tile>
        <Story />
      </Tile>
    ),
    withGonogoFrame,
  ],
} satisfies Meta<typeof Fill>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A graph filling the whole tile, with a notice pill pinned over its corner by the fill's positioning. */
export const GraphWithOverlay: Story = {
  args: {
    children: (
      <>
        <AscentTrace />
        <GraphNotice placement="overlay">Telemetry held 12 s</GraphNotice>
      </>
    ),
  },
};

/** A `grow` slot in a column: the graph takes what the notice row below it leaves. */
export const GrowSlot: Story = {
  render: () => (
    <Stack fill gap="rows">
      <Fill grow>
        <AscentTrace />
        <GraphNotice placement="overlay">Kerbal X · ascent</GraphNotice>
      </Fill>
      <Notice tone="warn">
        Max Q in 8 s: throttle to 70 % to stay under the structural limit
      </Notice>
    </Stack>
  ),
};

/** Two grow slots sharing a column between them, each hosting its own overlay. */
export const TwoGrowSlots: Story = {
  render: () => (
    <Stack fill gap="rows">
      <Fill grow>
        <AscentTrace />
        <GraphNotice placement="overlay">Altitude</GraphNotice>
      </Fill>
      <Fill grow>
        <AscentTrace />
        <GraphNotice placement="overlay">Vertical speed</GraphNotice>
      </Fill>
    </Stack>
  ),
};

/** Centred content in a filling container, the shape of a widget's empty state. */
export const CentredContent: Story = {
  args: {
    style: { alignItems: "center", justifyContent: "center" },
    children: <Text level="muted">No active vessel on Kerbin</Text>,
  },
};
