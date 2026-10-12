import type { Meta, StoryObj } from "@storybook/react-vite";
import { withGonogoFrame } from "../../frame";
import { LandingOutsideFlight } from "../../landingStillScenes";

const meta = {
  title: "Widgets/landing-status/Outside a flight",
  component: LandingOutsideFlight,
  decorators: [withGonogoFrame],
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof LandingOutsideFlight>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Landing Status while the game is at the space centre: the gate every flight widget stands behind, at the widget's full tile size. */
export const SpaceCentre: Story = {
  args: { scene: "SpaceCenter" },
};
