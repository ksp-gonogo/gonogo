import { ReckoningMarkSvg } from "@ksp-gonogo/ui-kit";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { withGonogoFrame } from "../../frame";

const meta = {
  title: "ui-kit/ReckoningMarkSvg",
  component: ReckoningMarkSvg,
  decorators: [
    (Story) => (
      <svg width={160} height={60} role="img" aria-label="Reckoning marks">
        <Story />
      </svg>
    ),
    withGonogoFrame,
  ],
  args: { kind: "held", x: 30, y: 30, scale: 3 },
} satisfies Meta<typeof ReckoningMarkSvg>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A position last seen, drawn as a square. */
export const Held: Story = {};

/** A position from a model, drawn as a triangle. */
export const Modelled: Story = { args: { kind: "modelled" } };

/** The held mark drawn faint, beside a modelled position. */
export const Ghost: Story = { args: { ghost: true } };
