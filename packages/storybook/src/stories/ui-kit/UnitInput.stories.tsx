import { type Reading, type Value, value } from "@ksp-gonogo/sitrep-sdk";
import { UnitInput, type UnitInputProps } from "@ksp-gonogo/ui-kit";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { withGonogoFrame } from "../../frame";
import { held } from "../../readings";

type Magnitude<Unit extends string> = Value<Unit> | Reading<Value<Unit>> | null;

/** A UnitInput holding its own value, so typing, sliding and turning the wheel all land. */
function Controlled<Unit extends string>({
  initial,
  ...rest
}: Omit<UnitInputProps<Unit>, "value" | "onChange"> & {
  initial: Magnitude<Unit>;
}) {
  const [current, setCurrent] = useState<Magnitude<Unit>>(initial);
  return (
    <UnitInput<Unit>
      {...(rest as Omit<UnitInputProps<Unit>, "value" | "onChange">)}
      value={current}
      onChange={setCurrent}
    />
  );
}

const meta = {
  title: "ui-kit/UnitInput",
  component: UnitInput,
  decorators: [
    (Story) => (
      <div style={{ width: 360 }}>
        <Story />
      </div>
    ),
    withGonogoFrame,
  ],
} satisfies Meta<typeof UnitInput>;

export default meta;
type Story = StoryObj<typeof UnitInput>;

/** One field in the unit, holding what is typed in it. Type a figure and it is emitted as a quantity. */
export const Metres: Story = {
  render: () => (
    <Controlled label="Target altitude" unit="m" initial={value("m", 80_000)} />
  ),
};

/** A value written across rungs of its unit, hours, minutes and seconds adding up to one duration. */
export const Duration: Story = {
  render: () => (
    <Controlled
      label="Burn duration"
      unit="s"
      rungs={["h", "min", "s"]}
      initial={value("s", 754)}
    />
  ),
};

/** Bounds add a slider beside the field; moving either one moves the other. */
export const WithSlider: Story = {
  render: () => (
    <Controlled
      label="Throttle limit"
      unit="%"
      range={{ min: 0, max: 100, step: 1 }}
      initial={value("%", 70)}
    />
  ),
};

/** A notch size adds a rate wheel: hold it displaced and the value keeps stepping. */
export const WithRateWheel: Story = {
  render: () => (
    <Controlled
      label="Node time"
      unit="s"
      rate={{ step: 10 }}
      initial={value("s", 600)}
    />
  ),
};

/** Nothing set yet: an empty box, ready for a first figure. */
export const Empty: Story = {
  render: () => <Controlled label="Target altitude" unit="m" initial={null} />,
};

/** A reading that stopped arriving: the field's name is marked held, and it can still be edited. */
export const HeldReading: Story = {
  render: () => (
    <Controlled label="Target altitude" unit="m" initial={held("m", 80_000)} />
  ),
};

/** Greyed out, ignoring input. */
export const Disabled: Story = {
  render: () => (
    <Controlled
      label="Target altitude"
      unit="m"
      initial={value("m", 80_000)}
      disabled
    />
  ),
};
