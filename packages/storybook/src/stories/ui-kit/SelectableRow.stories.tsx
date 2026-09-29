import { value } from "@ksp-gonogo/sitrep-sdk";
import { SelectableRow, Stack, Text, Unit } from "@ksp-gonogo/ui-kit";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { type ReactNode, useState } from "react";
import { withGonogoFrame } from "../../frame";

function Column({ children }: { children: ReactNode }) {
  return <div style={{ width: 320 }}>{children}</div>;
}

const meta = {
  title: "ui-kit/SelectableRow",
  component: SelectableRow,
  decorators: [
    (Story) => (
      <Column>
        <Story />
      </Column>
    ),
    withGonogoFrame,
  ],
  args: { selected: false },
} satisfies Meta<typeof SelectableRow>;

export default meta;
type Story = StoryObj<typeof meta>;

const SERVOS = [
  { id: "hinge", name: "Solar panel hinge", angle: 90 },
  { id: "rotor", name: "Radar dish rotor", angle: 215 },
  { id: "piston", name: "Docking port piston", angle: 0 },
] as const;

/** A pick-one list: click a servo to target it, and the go-toned fill follows the pick. */
export const PickOne: Story = {
  render: function Render() {
    const [picked, setPicked] = useState<string>("rotor");
    return (
      <Stack gap="rows" role="group" aria-label="Target servo">
        {SERVOS.map((servo) => (
          <SelectableRow
            key={servo.id}
            selected={picked === servo.id}
            onClick={() => setPicked(servo.id)}
          >
            <span>{servo.name}</span>
            <Text size="xs" tone={picked === servo.id ? undefined : "muted"}>
              <Unit value={value("°", servo.angle)} />
            </Text>
          </SelectableRow>
        ))}
      </Stack>
    );
  },
};

/** An unselected row: bordered, transparent, text in the surrounding colour. */
export const Unselected: Story = {
  args: {
    selected: false,
    children: (
      <>
        <span>Mun Lander II</span>
        <span>Mun · 1.4 km</span>
      </>
    ),
  },
};

/** A selected row: the go-toned fill, with its text tinted to match. */
export const Selected: Story = {
  args: {
    selected: true,
    children: (
      <>
        <span>Kerbal X</span>
        <span>Kerbin · 84.3 km</span>
      </>
    ),
  },
};

/** A wider gap between the name and the meta line. */
export const WideGap: Story = {
  args: {
    selected: false,
    gap: "related",
    children: (
      <>
        <span>Jebediah Kerman</span>
        <span>Pilot · Level 3 · Aboard Kerbal X</span>
      </>
    ),
  },
};

/** A disabled row, for a choice that exists but cannot be picked now: it cannot be clicked or focused. */
export const Disabled: Story = {
  args: {
    selected: false,
    disabled: true,
    children: (
      <>
        <span>Eeloo probe</span>
        <span>Out of comms range</span>
      </>
    ),
  },
};
