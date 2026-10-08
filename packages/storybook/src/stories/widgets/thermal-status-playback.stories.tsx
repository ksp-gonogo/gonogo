import type { Meta, StoryObj } from "@storybook/react-vite";
import { thermalReentryScenario } from "../../../scripts/thermalReentryModel";
import { withGonogoFrame } from "../../frame";
import { PlaybackScene, type PlaybackSceneProps } from "../../playbackScene";

const SCENARIO = thermalReentryScenario();

function Scene(props: Omit<PlaybackSceneProps, "scenario">) {
  return <PlaybackScene scenario={SCENARIO} {...props} />;
}

const meta = {
  title: "Widgets/thermal-status/Re-entry playback",
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
 * A capsule through re-entry. The antenna heats first and reaches the critical
 * band, then lets go as the pod and the heat shield soak up the heat and take
 * over as the hottest part, with the shield flux peaking between. Replay starts
 * it over.
 */
export const ReentryHeating: Story = {
  name: "Re-entry heating",
};
