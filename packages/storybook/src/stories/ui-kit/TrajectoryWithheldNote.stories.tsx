import {
  TrajectoryWithheldNote,
  type WithheldTrajectory,
} from "@ksp-gonogo/ui-kit";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { withGonogoFrame } from "../../frame";

const withheld = (reason: WithheldTrajectory["reason"]): WithheldTrajectory =>
  ({ shape: "withheld", reason }) as WithheldTrajectory;

const meta = {
  title: "ui-kit/TrajectoryWithheldNote",
  component: TrajectoryWithheldNote,
  decorators: [
    (Story) => (
      <div style={{ width: 320 }}>
        <Story />
      </div>
    ),
    withGonogoFrame,
  ],
  args: { withheld: withheld("shape-not-stated") },
} satisfies Meta<typeof TrajectoryWithheldNote>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A path whose shape nothing has stated, with the sentence under the heading. */
export const ShapeNotStated: Story = {};

/** A path asked for in a frame the known bodies cannot build. */
export const FrameUnavailable: Story = {
  args: { withheld: withheld("frame-unavailable") },
};

/** A path no integration could sample. */
export const NoPathAvailable: Story = {
  args: { withheld: withheld("no-arc-available") },
};

/** The heading alone, the sentence on hover, for a strip beside a readout. */
export const Compact: Story = {
  args: { withheld: withheld("no-horizon-stated"), compact: true },
};
