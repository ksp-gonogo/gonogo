import type { Meta, StoryObj } from "@storybook/react-vite";
import { fuelBurnScenario } from "../../../scripts/fuelBurnModel";
import { withGonogoFrame } from "../../frame";
import { PlaybackScene, type PlaybackSceneProps } from "../../playbackScene";

const SCENARIO = fuelBurnScenario();

function Scene(props: Omit<PlaybackSceneProps, "scenario">) {
  return <PlaybackScene scenario={SCENARIO} {...props} />;
}

const meta = {
  title: "Widgets/fuel-status/Burn playback",
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
 * An asparagus rocket burning from the top of its stack. Tank levels, the
 * delta-v and burn time left and the TWR all move with the fuel; a stage drops
 * out of the list once it is empty and the current stage follows. Replay starts
 * it over.
 */
export const BurnThroughTheStack: Story = {
  name: "Burn through the stack",
};
