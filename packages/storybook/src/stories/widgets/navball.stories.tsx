import type { Meta, StoryObj } from "@storybook/react-vite";
import { withGonogoFrame } from "../../frame";
import { NavballAscentScene } from "../../playbackScenes";

const meta = {
  title: "Widgets/navball/Gravity turn playback",
  component: NavballAscentScene,
  tags: ["playback"],
  decorators: [withGonogoFrame],
  parameters: { layout: "fullscreen" },
  argTypes: {
    w: { control: { type: "range", min: 3, max: 36, step: 1 } },
    h: { control: { type: "range", min: 3, max: 40, step: 1 } },
  },
} satisfies Meta<typeof NavballAscentScene>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * A rocket lifting off, rolling out to heading 90, pitching over and holding
 * prograde as the turn flattens, its throttle easing back through max-Q. Played
 * at three times real time; Replay starts it over.
 */
export const GravityTurn: Story = {
  name: "Gravity turn",
  args: { w: 8, h: 11 },
};
