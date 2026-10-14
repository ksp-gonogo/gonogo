import type { Meta, StoryObj } from "@storybook/react-vite";
import { withGonogoFrame } from "../../frame";
import { SystemTransferScene } from "../../playbackScenes";

const meta = {
  title: "Widgets/tracking-station/Transfer playback",
  component: SystemTransferScene,
  tags: ["playback"],
  decorators: [withGonogoFrame],
  parameters: { layout: "fullscreen" },
  argTypes: {
    w: { control: { type: "range", min: 3, max: 36, step: 1 } },
    h: { control: { type: "range", min: 3, max: 40, step: 1 } },
    follow: { control: { type: "boolean" } },
  },
} satisfies Meta<typeof SystemTransferScene>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * A craft that has just left a 100 km Kerbin orbit on the Hohmann ellipse to the
 * Mun. Played at 600 times real time: the Mun swings round its orbit, the craft
 * climbs its ellipse and the phase angle between them closes. The view follows
 * the craft, zoomed in on it, as Focus vessel leaves it. Where the craft reaches
 * the Mun's sphere of influence it brakes into orbit about the Mun and the
 * diagram becomes the Mun's: the picture holds where it was, Kerbin stays
 * marked as the body the Mun orbits, and the caption names the frame it left.
 * The craft is then played at 1500 times real time from apoapsis to periapsis.
 * With `follow` off the view is left as it mounts. Replay starts it over.
 */
export const MunTransfer: Story = {
  name: "Mun transfer",
  args: { w: 20, h: 18, follow: true },
};
