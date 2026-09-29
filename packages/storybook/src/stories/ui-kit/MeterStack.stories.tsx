import { Meter, MeterStack, resourceColor } from "@ksp-gonogo/ui-kit";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactNode } from "react";
import { withGonogoFrame } from "../../frame";
import { held, live, pending } from "../../readings";

function Column({
  width = 360,
  children,
}: {
  width?: number;
  children: ReactNode;
}) {
  return <div style={{ width }}>{children}</div>;
}

/** The resources of Kerbal X's upper stage, as row meters. */
function Tanks() {
  return (
    <>
      <Meter
        layout="row"
        label="Liquid fuel"
        value={live("units", 1_260)}
        capacity={live("units", 3_600)}
        fillColor={resourceColor("LiquidFuel")}
      />
      <Meter
        layout="row"
        label="Oxidizer"
        value={live("units", 1_540)}
        capacity={live("units", 4_400)}
        fillColor={resourceColor("Oxidizer")}
      />
      <Meter
        layout="row"
        label="Monopropellant"
        value={live("units", 38)}
        capacity={live("units", 120)}
        fillColor={resourceColor("MonoPropellant")}
      />
      <Meter
        layout="row"
        label="Electric charge"
        value={live("units", 180)}
        capacity={live("units", 400)}
        fillColor={resourceColor("ElectricCharge")}
      />
    </>
  );
}

const meta = {
  title: "ui-kit/MeterStack",
  component: MeterStack,
  decorators: [
    (Story) => (
      <Column>
        <Story />
      </Column>
    ),
    withGonogoFrame,
  ],
} satisfies Meta<typeof MeterStack>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A vessel's tanks as row meters: every label, bar and figure shares one set of columns, so the bars start at the same x. */
export const Resources: Story = {
  render: () => (
    <MeterStack>
      <Tanks />
    </MeterStack>
  ),
};

/** Stacked meters, label and figure above each bar, listed one under another. */
export const Stacked: Story = {
  render: () => (
    <MeterStack>
      <Meter
        label="Jebediah Kerman · Dose"
        value={live("ratio", 0.12)}
        tone="go"
      />
      <Meter
        label="Bill Kerman · Dose"
        value={live("ratio", 0.39)}
        tone="warn"
      />
      <Meter
        label="Bob Kerman · Dose"
        value={live("ratio", 0.81)}
        tone="nogo"
      />
    </MeterStack>
  ),
};

/** A column too narrow for figures beside the bars moves every figure under its bar at once. */
export const FiguresBelow: Story = {
  decorators: [
    (Story) => (
      <Column width={220}>
        <Story />
      </Column>
    ),
  ],
  render: () => (
    <MeterStack>
      <Tanks />
    </MeterStack>
  ),
};

/** Rows with long and short labels, and held and pending figures, still line up. */
export const MixedCurrency: Story = {
  render: () => (
    <MeterStack>
      <Meter
        layout="row"
        label="LF"
        value={live("units", 1_260)}
        capacity={live("units", 3_600)}
      />
      <Meter
        layout="row"
        label="Xenon gas, ion stage"
        value={held("units", 2_900)}
        capacity={live("units", 5_700)}
      />
      <Meter layout="row" label="Ore" value={pending()} />
      <Meter
        layout="row"
        label="Ablator"
        value={live("units", 640)}
        capacity={held("units", 800)}
      />
    </MeterStack>
  ),
};
