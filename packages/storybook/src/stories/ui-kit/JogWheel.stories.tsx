import { JogWheel, type JogWheelProps } from "@ksp-gonogo/ui-kit";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { withGonogoFrame } from "../../frame";

/**
 * The wheel is controlled, so each story holds its value: a story that passed
 * a fixed `value` would drop every drag and look broken.
 */
function Held(props: JogWheelProps) {
  const [value, setValue] = useState(props.value);
  return <JogWheel {...props} value={value} onChange={setValue} />;
}

const meta = {
  title: "ui-kit/JogWheel",
  component: JogWheel,
  decorators: [withGonogoFrame],
  render: (args) => <Held key={`${args.min}:${args.max}`} {...args} />,
  args: {
    ariaLabel: "Throttle trim",
    value: 50,
    min: 0,
    max: 100,
    step: 1,
    onChange: () => {},
  },
} satisfies Meta<typeof JogWheel>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Drag along the wheel or use the arrow keys; Home and End jump to the ends. */
export const Offset: Story = {};

/** Dragging up raises the value. */
export const Vertical: Story = {
  args: { orientation: "vertical", ariaLabel: "Pitch trim" },
};

/** A half step, with the caret written to one decimal. */
export const Fractional: Story = {
  args: {
    ariaLabel: "Gimbal trim",
    value: 12.5,
    min: 0,
    max: 60,
    step: 0.5,
    format: (v: number) => v.toFixed(1),
  },
};

/** Displacement sets the speed, and the wheel springs back on release. */
export const Rate: Story = {
  render: () => (
    <Held
      mode="rate"
      ariaLabel="Scrub time"
      value={0}
      step={1}
      stepsPerSecond={20}
      onChange={() => {}}
    />
  ),
};

export const Disabled: Story = {
  args: { disabled: true },
};
