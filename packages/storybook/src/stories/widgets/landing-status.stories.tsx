import type { Meta, StoryObj } from "@storybook/react-vite";
import { withGonogoFrame } from "../../frame";
import { LandingDescentScene } from "../../landingDescentScenes";

const meta = {
  title: "Widgets/landing-status/Descent playback",
  component: LandingDescentScene,
  tags: ["playback"],
  decorators: [withGonogoFrame],
  parameters: { layout: "fullscreen" },
  argTypes: {
    w: { control: { type: "range", min: 3, max: 36, step: 1 } },
    h: { control: { type: "range", min: 3, max: 40, step: 1 } },
  },
} satisfies Meta<typeof LandingDescentScene>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * A lander falling from 8 km over the Mun that lights its engine at 700 m,
 * far too late to cancel the speed it has built, and meets the ground at about
 * 140 m/s. Played at six times real time; Replay starts it over.
 */
export const CrashLanding: Story = {
  name: "Crash landing",
  args: { crash: true },
};

/**
 * The same descent under a suicide burn that bleeds off the horizontal speed on
 * the way down and settles to a gentle touchdown. Played at six times real
 * time; Replay starts it over.
 */
export const SafeLanding: Story = {
  name: "Safe landing",
  args: { crash: false },
};
