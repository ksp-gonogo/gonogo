import type { Meta, StoryObj } from "@storybook/react-vite";
import { withGonogoFrame } from "../../frame";
import { LandingReplayScene } from "../../landingReplayScenes";

const meta = {
  title: "Widgets/landing-status/Recorded landings",
  component: LandingReplayScene,
  tags: ["playback"],
  decorators: [withGonogoFrame],
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof LandingReplayScene>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A low pass over the Mun that never meets the ground, recorded off the wire of a real game: the widget says no landing is in progress throughout. */
export const LowPass: Story = {
  name: "Low pass",
  args: { recording: "lowpass" },
};

/** A fast crash on the Mun recorded off the wire of a real game: the burn, the fall, the impact and what the wreck reports afterwards. */
export const FastCrash: Story = {
  name: "Fast crash",
  args: { recording: "crashfall" },
};

/** The same crash, and then the game leaves the flight scene for the space centre: the dashboard's flight gate would hide the widget, and the crash on record holds it open as the record of the last flight. */
export const CrashThenLeavesFlight: Story = {
  name: "Fast crash, then the game leaves the flight scene",
  args: { recording: "crashleaves" },
};
