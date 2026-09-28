import { value } from "@ksp-gonogo/sitrep-sdk";
import { Meter, MeterStack, resourceColor } from "@ksp-gonogo/ui-kit";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactNode } from "react";
import { withGonogoFrame } from "../../frame";
import { absent, held, live, pending } from "../../readings";

function Column({ children }: { children: ReactNode }) {
  return <div style={{ width: 360 }}>{children}</div>;
}

const meta = {
  title: "ui-kit/Meter",
  component: Meter,
  decorators: [
    (Story) => (
      <Column>
        <Story />
      </Column>
    ),
    withGonogoFrame,
  ],
  args: { label: "Radiation dose" },
} satisfies Meta<typeof Meter>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A current fraction, drawn as the fill and written in the header. */
export const Live: Story = {
  args: { value: live("ratio", 0.62), tone: "warn" },
};

/** An amount over a capacity in the same unit: the bar draws the quotient. */
export const Tank: Story = {
  args: {
    label: "Liquid fuel",
    value: live("units", 1260),
    capacity: live("units", 3600),
  },
};

/** The last figure after the link dropped: the fill is marked held. */
export const Held: Story = {
  args: { value: held("ratio", 0.62), tone: "warn" },
};

/** A capacity that stopped arriving dashes the track, not the fill. */
export const HeldCapacity: Story = {
  args: {
    label: "Liquid fuel",
    value: live("units", 1260),
    capacity: held("units", 3600),
  },
};

/** Nothing has arrived: the null token and an empty track, not a 0% bar. */
export const Pending: Story = {
  args: { value: pending() },
};

/** The source confirmed there is no value. */
export const Absent: Story = {
  args: { value: absent() },
};

/** A one-sigma band from a fitted rate: two ticks at its ends. */
export const SigmaBand: Story = {
  args: {
    value: live("ratio", 0.62, { lo: 0.53, hi: 0.71, kind: "sigma1" }),
  },
};

/** A hard bound: the value is inside it. */
export const BoundBand: Story = {
  args: {
    value: live("ratio", 0.62, { lo: 0.6, hi: 0.64, kind: "bound" }),
  },
};

/** A held figure with the model still bounding where it is now. */
export const HeldWithBand: Story = {
  args: {
    value: held("ratio", 0.62, { lo: 0.58, hi: 0.82, kind: "sigma1" }),
  },
};

/** A capacity with its own doubt marks the end of the track. */
export const CapacityBand: Story = {
  args: {
    label: "Electric charge",
    value: live("units", 180),
    capacity: live("units", 400, { lo: 370, hi: 400, kind: "bound" }),
  },
};

/** Each tone on the same figure. */
export const Tones: Story = {
  render: (args) => (
    <MeterStack>
      {(["neutral", "go", "warn", "nogo", "info"] as const).map((tone) => (
        <Meter key={tone} {...args} label={tone} tone={tone} />
      ))}
    </MeterStack>
  ),
  args: { value: live("ratio", 0.62) },
};

/** A fill that carries an identity rather than a status. */
export const FillColour: Story = {
  args: {
    label: "Oxidizer",
    value: live("units", 2200),
    capacity: live("units", 4400),
    fillColor: resourceColor("Oxidizer"),
  },
};

/** Row layout: a stack of rows shares its columns, so every bar starts at the same x. */
export const Rows: Story = {
  render: () => (
    <MeterStack>
      <Meter
        layout="row"
        label="Jeb · Dose"
        value={live("ratio", 0.39, { lo: 0.379, hi: 0.401, kind: "sigma1" })}
        tone="warn"
      />
      <Meter
        layout="row"
        label="Jeb · Stress"
        value={held("ratio", 0.72)}
        tone="nogo"
      />
      <Meter
        layout="row"
        label="Jeb · Pressure"
        value={live("ratio", 0.12)}
        tone="go"
      />
      <Meter layout="row" label="Bill · Dose" value={pending()} />
      <Meter
        layout="row"
        label="Fuel"
        value={live("units", 1260)}
        capacity={live("units", 3600)}
      />
    </MeterStack>
  ),
  args: { value: value("ratio", 0) },
};
