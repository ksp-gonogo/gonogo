import type { Meta, StoryObj } from "@storybook/react-vite";
import { CommsPlaybackScene } from "../../commcastPlayback";
import { withGonogoFrame } from "../../frame";

const meta = {
  title: "Widgets/commcast/Loop playback",
  component: CommsPlaybackScene,
  decorators: [withGonogoFrame],
  parameters: { layout: "fullscreen" },
  argTypes: {
    w: { control: { type: "range", min: 4, max: 36, step: 1 } },
    h: { control: { type: "range", min: 5, max: 40, step: 1 } },
  },
} satisfies Meta<typeof CommsPlaybackScene>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * The ground station listening to the craft. The link comes up, the craft and
 * the range trade calls, and the signal fades under a transmission until a
 * blackout cuts it off mid-word; the link then returns and the craft finishes
 * its call. Press Play to hear it: nothing sounds before then, since a browser
 * only starts audio from a press. Replay starts it over.
 */
export const LinkThroughABlackout: Story = {
  name: "Signal fading into a blackout",
};
