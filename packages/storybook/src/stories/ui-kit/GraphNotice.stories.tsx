import { GraphNotice } from "@ksp-gonogo/ui-kit";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactNode } from "react";
import { withGonogoFrame } from "../../frame";

/** A stand-in altitude trace, so the notice has a graph to sit over or under. */
function AltitudeTrace() {
  return (
    <svg
      viewBox="0 0 400 160"
      width="100%"
      height="160"
      role="img"
      aria-label="Altitude over the last ten minutes"
      style={{
        display: "block",
        background: "var(--color-surface-sunken)",
        border: "1px solid var(--color-border-subtle)",
      }}
    >
      <polyline
        fill="none"
        stroke="var(--color-accent-fg)"
        strokeWidth="2"
        points="0,150 40,146 80,136 120,118 160,96 200,74 240,56 280,44 320,38 360,35 400,34"
      />
      <text
        x="396"
        y="14"
        fontSize="10"
        textAnchor="end"
        fill="var(--color-text-muted)"
      >
        80 km
      </text>
      <text
        x="396"
        y="156"
        fontSize="10"
        textAnchor="end"
        fill="var(--color-text-muted)"
      >
        0 km
      </text>
    </svg>
  );
}

function Graph({ children }: { children?: ReactNode }) {
  return (
    <div style={{ width: 420, position: "relative" }}>
      <AltitudeTrace />
      {children}
    </div>
  );
}

const meta = {
  title: "ui-kit/GraphNotice",
  component: GraphNotice,
  decorators: [withGonogoFrame],
  args: { placement: "overlay", children: "No reference trajectory" },
} satisfies Meta<typeof GraphNotice>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Pinned to the graph's bottom-left corner, saying why a reference line is missing. */
export const Overlay: Story = {
  render: (args) => (
    <Graph>
      <GraphNotice {...args} />
    </Graph>
  ),
};

/** Over the middle of an empty plot, where there is no data underneath to cover. */
export const Center: Story = {
  args: { placement: "center", children: "No atmosphere on Mun" },
  render: (args) => (
    <Graph>
      <GraphNotice {...args} />
    </Graph>
  ),
};

/** A flow row under the graph, where an overlay would cover the x-axis labels. */
export const Inline: Story = {
  args: {
    placement: "inline",
    children: "Unknown body: Eeloo terrain not loaded",
  },
  render: (args) => (
    <div style={{ width: 420, display: "flex", flexDirection: "column" }}>
      <AltitudeTrace />
      <GraphNotice {...args} />
    </div>
  ),
};

/** A column at the graph's right, for a wide, short graph where a row below would cost it much of its height. */
export const Beside: Story = {
  args: {
    placement: "beside",
    children: "Unknown body: Eeloo terrain not loaded",
  },
  render: (args) => (
    <div style={{ width: 640, display: "flex", flexDirection: "row" }}>
      <div style={{ flex: 1 }}>
        <AltitudeTrace />
      </div>
      <GraphNotice {...args} />
    </div>
  ),
};

/** A notice longer than the graph is wide wraps inside its pill. */
export const LongNotice: Story = {
  args: {
    placement: "inline",
    children:
      "Recorded telemetry: the stream dropped during the Mun transfer burn and this trace ends at the last frame received",
  },
  render: (args) => (
    <div style={{ width: 260, display: "flex", flexDirection: "column" }}>
      <AltitudeTrace />
      <GraphNotice {...args} />
    </div>
  ),
};
