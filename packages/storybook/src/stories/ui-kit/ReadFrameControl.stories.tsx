import {
  ReadFrameControl,
  type ReadFrameControlProps,
  type ReadFrameOption,
} from "@ksp-gonogo/ui-kit";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { withGonogoFrame } from "../../frame";

const KERBIN_INERTIAL: ReadFrameOption = {
  choice: { kind: "body-centred-inertial", bodyIndex: 0 },
  label: "Kerbin",
};
const MUN_PARENT_DIRECTION: ReadFrameOption = {
  choice: { kind: "parent-direction", bodyIndex: 1 },
  label: "Mun, parent direction",
};
const MUN_ROTATING: ReadFrameOption = {
  choice: { kind: "rotating-pulsating", bodyIndex: 1 },
  label: "Mun, rotating",
};
const FOLLOW_CONTROL_FRAME: ReadFrameOption = {
  choice: { kind: "follow-control-frame" },
  label: "Follow the in-game view",
};

const OPTIONS: readonly ReadFrameOption[] = [
  KERBIN_INERTIAL,
  MUN_PARENT_DIRECTION,
  MUN_ROTATING,
  FOLLOW_CONTROL_FRAME,
];

/** A picker holding its own choice, so a click moves the selection. */
function Controlled({
  initial,
  options = OPTIONS,
  ...rest
}: Omit<ReadFrameControlProps, "value" | "onChange" | "options"> & {
  initial: ReadFrameControlProps["value"];
  options?: ReadFrameControlProps["options"];
}) {
  const [value, setValue] = useState(initial);
  return (
    <ReadFrameControl
      {...rest}
      options={options}
      value={value}
      onChange={setValue}
    />
  );
}

const meta = {
  title: "ui-kit/ReadFrameControl",
  component: ReadFrameControl,
  decorators: [
    (Story) => (
      <div style={{ width: 360 }}>
        <Story />
      </div>
    ),
    withGonogoFrame,
  ],
  args: {
    id: "read-frame",
    label: "Draw the picture in",
    options: OPTIONS,
    value: KERBIN_INERTIAL.choice,
    onChange: () => {},
  },
} satisfies Meta<typeof ReadFrameControl>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Kerbin's inertial frame picked, the ordinary state. */
export const Default: Story = {
  render: () => (
    <Controlled
      id="read-frame"
      label="Draw the picture in"
      initial={KERBIN_INERTIAL.choice}
    />
  ),
};

/** "Follow the in-game view" picked, offered only when it draws something the other entries do not. */
export const FollowControlFrame: Story = {
  render: () => (
    <Controlled
      id="read-frame"
      label="Draw the picture in"
      initial={FOLLOW_CONTROL_FRAME.choice}
    />
  ),
};

/** The value matches nothing on `options`, e.g. before the widget's catalogue has arrived: a blank, disabled placeholder rather than a false match. */
export const Unresolved: Story = {
  render: () => (
    <Controlled
      id="read-frame"
      label="Draw the picture in"
      options={[KERBIN_INERTIAL, MUN_PARENT_DIRECTION]}
      initial={{ kind: "rotating-pulsating", bodyIndex: 1 }}
    />
  ),
};

/** The optional hint line under the control. */
export const WithHint: Story = {
  render: () => (
    <Controlled
      id="read-frame"
      label="Draw the picture in"
      initial={KERBIN_INERTIAL.choice}
      hint="This changes what the axes do, not which body is in the middle."
    />
  ),
};
