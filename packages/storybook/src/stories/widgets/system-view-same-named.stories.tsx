import type { Meta, StoryObj } from "@storybook/react-vite";
import scene from "../../../../components/src/SystemView/__playground__/same-named-craft.json";
import { withGonogoFrame } from "../../frame";
import { WidgetScene } from "../../WidgetScene";

const meta = {
  title: "Widgets/system-view/Same-named craft",
  component: WidgetScene,
  decorators: [withGonogoFrame],
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof WidgetScene>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Five craft that all carry the name Sally-Hut 1: one in a 3,000 km Kerbin
 * orbit and four on the ground at the launch pad, the runway and two other
 * launch sites. Select any of them and the aside names it by its place and
 * lists its site and position.
 */
export const FiveSallyHuts: Story = {
  name: "Five Sally-Huts",
  args: { widgetId: "system-view", fixture: scene, w: 20, h: 18 },
};
