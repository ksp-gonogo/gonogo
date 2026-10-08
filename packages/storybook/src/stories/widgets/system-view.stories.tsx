import type { Meta, StoryObj } from "@storybook/react-vite";
import { withGonogoFrame } from "../../frame";
import { SystemTransferScene } from "../../playbackScenes";

const meta = {
  title: "Widgets/system-view/Transfer playback",
  component: SystemTransferScene,
  tags: ["playback"],
  decorators: [withGonogoFrame],
  parameters: { layout: "fullscreen" },
  argTypes: {
    w: { control: { type: "range", min: 3, max: 36, step: 1 } },
    h: { control: { type: "range", min: 3, max: 40, step: 1 } },
  },
} satisfies Meta<typeof SystemTransferScene>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * A craft that has just left a 100 km Kerbin orbit on the Hohmann ellipse to the
 * Mun, coasting 7.3 hours to the edge of the Mun's sphere of influence. Played at
 * 600 times real time: the Mun swings round its orbit, the craft climbs its
 * ellipse and the phase angle between them closes. Replay starts it over.
 */
export const MunTransfer: Story = {
  name: "Mun transfer",
  args: { w: 20, h: 18 },
};
