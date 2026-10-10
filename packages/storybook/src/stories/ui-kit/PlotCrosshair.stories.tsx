import { PlotCrosshair, type PlotCrosshairProps } from "@ksp-gonogo/ui-kit";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { withGonogoFrame } from "../../frame";

const PLOT = { x0: 40, y0: 10, x1: 360, y1: 170 };

function OnPlot(props: PlotCrosshairProps) {
  return (
    <svg
      width={380}
      height={190}
      role="img"
      aria-label="Plot with a crosshair"
      style={{ background: "var(--color-surface-panel)" }}
    >
      <rect
        x={PLOT.x0}
        y={PLOT.y0}
        width={PLOT.x1 - PLOT.x0}
        height={PLOT.y1 - PLOT.y0}
        fill="none"
        stroke="var(--color-border-subtle)"
      />
      <PlotCrosshair {...props} />
    </svg>
  );
}

const meta = {
  title: "ui-kit/PlotCrosshair",
  component: OnPlot,
  decorators: [withGonogoFrame],
  args: {
    x: 160,
    plot: PLOT,
    heading: "T+00:12:40",
    rows: [
      {
        id: "alt",
        label: "Altitude",
        color: "#4fc3f7",
        value: "84.3 km",
        currency: "measured",
        y: 60,
      },
      {
        id: "vel",
        label: "Velocity",
        color: "#ffb74d",
        value: "2 310 m/s",
        currency: "measured",
        y: 110,
      },
    ],
  },
} satisfies Meta<typeof OnPlot>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Two measured traces read at one instant. */
export const TwoTraces: Story = {};

/** A modelled figure, an absent sample and a limit with no point on the plot. */
export const MixedRows: Story = {
  args: {
    rows: [
      {
        id: "alt",
        label: "Altitude",
        color: "#4fc3f7",
        value: "84.3 km",
        modelled: true,
        y: 60,
      },
      { id: "vel", label: "Velocity", color: "#ffb74d", value: null, y: null },
      { id: "max", label: "Max Q limit", color: "#e57373", value: "30 kPa" },
    ],
  },
};
