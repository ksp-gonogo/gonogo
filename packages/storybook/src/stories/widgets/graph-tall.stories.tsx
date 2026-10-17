import type { Meta, StoryObj } from "@storybook/react-vite";
import ascent from "../../../../components/src/Graph/__fixtures__/ascent-altitude-velocity.json";
import { withGonogoFrame } from "../../frame";
import { WidgetScene } from "../../WidgetScene";

const meta = {
  title: "Widgets/graph/Tall",
  component: WidgetScene,
  decorators: [withGonogoFrame],
  parameters: { layout: "fullscreen" },
  args: { widgetId: "graph", fixture: ascent },
  argTypes: {
    widgetId: { control: false },
    fixture: { control: false },
    withhold: { control: false },
    mode: { control: false },
    w: { control: { type: "range", min: 1, max: 36, step: 1 } },
    h: { control: { type: "range", min: 1, max: 40, step: 1 } },
  },
} satisfies Meta<typeof WidgetScene>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Altitude and orbital speed against time in a tall tile, where a legend placed under the plot has room to sit there. */
export const TallTile: Story = {
  name: "Tall",
  args: {
    w: 10,
    h: 20,
    mode: {
      config: {
        windowSec: 600,
        series: [
          {
            id: "alt",
            key: "vessel.flight.altitudeAsl",
            label: "Altitude",
            axis: "primary",
          },
          {
            id: "ospd",
            key: "vessel.flight.orbitalSpeed",
            label: "Orbital speed",
            axis: "secondary",
          },
        ],
      },
    },
  },
};
