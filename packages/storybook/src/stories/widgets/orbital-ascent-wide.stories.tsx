import type { Meta, StoryObj } from "@storybook/react-vite";
import ascent from "../../../../components/src/OrbitalAscent/__fixtures__/kerbin-ascent-to-67km.json";
import { withGonogoFrame } from "../../frame";
import { WidgetScene } from "../../WidgetScene";

const meta = {
  title: "Widgets/orbital-ascent/Wide",
  component: WidgetScene,
  decorators: [withGonogoFrame],
  parameters: { layout: "fullscreen" },
  args: { widgetId: "orbital-ascent", fixture: ascent },
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

/** The Kerbin ascent in a wide, short tile, where the legend and the info box share one row. */
export const WideTile: Story = {
  name: "Wide",
  args: { w: 16, h: 6 },
};
