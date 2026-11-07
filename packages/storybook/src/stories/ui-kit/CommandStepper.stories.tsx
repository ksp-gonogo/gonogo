import { value } from "@ksp-gonogo/sitrep-sdk";
import { CommandStepper, Unit } from "@ksp-gonogo/ui-kit";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { withGonogoFrame } from "../../frame";

const meta = {
  title: "ui-kit/CommandStepper",
  component: CommandStepper,
  decorators: [
    (Story) => (
      <div style={{ display: "grid", gridTemplateColumns: "auto auto auto" }}>
        <Story />
      </div>
    ),
    withGonogoFrame,
  ],
  args: {
    commanded: 340,
    min: 0,
    max: 460,
    step: 10,
    figure: (v: number) => <Unit value={value("rpm", v)} decimals={0} />,
    onChange: () => {},
    lowerLabel: "Lower RPM cap",
    raiseLabel: "Raise RPM cap",
  },
} satisfies Meta<typeof CommandStepper>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A command the craft has taken: the figure alone. */
export const Confirmed: Story = {};

/** 340 travels while 350 has reached the craft: the modelled figure is 350. */
export const ExpectedElsewhere: Story = { args: { expected: 350 } };

/** No live readings: the held figure is where the craft was last seen. */
export const LastSeenHeld: Story = {
  args: { lastSeen: 300, lastSeenCaption: "Blackout" },
};
