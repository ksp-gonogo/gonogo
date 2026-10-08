import type { Meta, StoryObj } from "@storybook/react-vite";
import { withGonogoFrame } from "../../frame";
import { MapOrbitScene } from "../../playbackScenes";

const meta = {
  title: "Widgets/map-view/Orbit playback",
  component: MapOrbitScene,
  tags: ["playback"],
  decorators: [withGonogoFrame],
  parameters: { layout: "fullscreen" },
  argTypes: {
    w: { control: { type: "range", min: 3, max: 36, step: 1 } },
    h: { control: { type: "range", min: 3, max: 40, step: 1 } },
  },
} satisfies Meta<typeof MapOrbitScene>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * A craft in an 85 km orbit at 28.5 degrees over two revolutions. The marker
 * crosses the planet and the predicted ground track carries on ahead of it, each
 * pass falling west of the last by the planet's turn beneath it. Played at 80
 * times real time; Replay starts it over.
 */
export const TwoOrbits: Story = {
  name: "Two orbits",
  args: { w: 14, h: 14 },
};
