import type { Meta, StoryObj } from "@storybook/react-vite";
import { warpLadderScenario } from "../../../scripts/warpLadderModel";
import { withGonogoFrame } from "../../frame";
import { PlaybackScene, type PlaybackSceneProps } from "../../playbackScene";

const SCENARIO = warpLadderScenario();

function Scene(props: Omit<PlaybackSceneProps, "scenario">) {
  return <PlaybackScene scenario={SCENARIO} {...props} />;
}

const meta = {
  title: "Widgets/warp-control/Warp playback",
  component: Scene,
  decorators: [withGonogoFrame],
  tags: ["playback"],
  parameters: { layout: "fullscreen" },
  argTypes: {
    w: { control: { type: "range", min: 3, max: 36, step: 1 } },
    h: { control: { type: "range", min: 3, max: 40, step: 1 } },
  },
} satisfies Meta<typeof Scene>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Time warp climbing the rails ladder a rung at a time to 100,000 times, holding
 * there, coming back down, then pausing and resuming. Replay starts it over.
 */
export const WarpLadder: Story = {
  name: "Warp up and down the ladder",
};
