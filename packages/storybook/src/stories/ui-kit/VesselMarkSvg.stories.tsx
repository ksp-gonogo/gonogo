import { VesselMarkSvg } from "@ksp-gonogo/ui-kit";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { withGonogoFrame } from "../../frame";

const meta = {
  title: "ui-kit/VesselMarkSvg",
  component: VesselMarkSvg,
  decorators: [
    (Story) => (
      <svg width={160} height={60} role="img" aria-label="Vessel marks">
        <Story />
      </svg>
    ),
    withGonogoFrame,
  ],
  args: { x: 30, y: 30, r: 14 },
} satisfies Meta<typeof VesselMarkSvg>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The vessel's position is current: the green circle. */
export const Current: Story = {};

/** The last position received. */
export const Held: Story = { args: { state: "held" } };

/** A position from a model. */
export const Modelled: Story = { args: { state: "modelled" } };

/** The link is lost. */
export const Lost: Story = { args: { state: "lost" } };

/** With the keyline, for a mark sitting on a picture. */
export const Keyline: Story = { args: { keyline: true } };
