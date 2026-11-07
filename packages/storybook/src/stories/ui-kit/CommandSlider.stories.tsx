import { value } from "@ksp-gonogo/sitrep-sdk";
import { CommandSlider, Unit } from "@ksp-gonogo/ui-kit";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { withGonogoFrame } from "../../frame";

const percent = (v: number) => (
  <Unit value={value("%", v * 100)} decimals={0} />
);

const meta = {
  title: "ui-kit/CommandSlider",
  component: CommandSlider,
  decorators: [
    (Story) => (
      <div style={{ width: 320 }}>
        <Story />
      </div>
    ),
    withGonogoFrame,
  ],
  args: {
    commanded: 0.5,
    min: 0,
    max: 1,
    step: 0.01,
    figure: percent,
    onChange: () => {},
    "aria-label": "Throttle",
  },
} satisfies Meta<typeof CommandSlider>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A command the craft has taken: nothing beside the thumb. */
export const Confirmed: Story = {};

/** A command on its way while an older one has reached the craft: the modelled mark sits at full. */
export const ExpectedElsewhere: Story = { args: { commanded: 0, expected: 1 } };

/** No live readings: the held mark is where the craft was last seen. */
export const LastSeenHeld: Story = {
  args: { commanded: 0.5, lastSeen: 0, lastSeenCaption: "Blackout" },
};
