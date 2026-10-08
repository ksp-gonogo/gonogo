import type { Meta, StoryObj } from "@storybook/react-vite";
import { commSignalScenario } from "../../../scripts/commSignalModel";
import { withGonogoFrame } from "../../frame";
import { PlaybackScene, type PlaybackSceneProps } from "../../playbackScene";

const SCENARIO = commSignalScenario();

function Scene(props: Omit<PlaybackSceneProps, "scenario">) {
  return <PlaybackScene scenario={SCENARIO} {...props} />;
}

const meta = {
  title: "Widgets/comm-signal/Blackout playback",
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
 * A link that is acquired, fades, is lost in a blackout and returns, the same
 * timeline as the Commcast loop playback. Replay starts it over.
 */
export const SignalBlackout: Story = {
  name: "Signal fading into a blackout",
};
