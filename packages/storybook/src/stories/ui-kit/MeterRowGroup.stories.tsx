import { value } from "@ksp-gonogo/sitrep-sdk";
import { Meter, MeterRowGroup, MeterStack, Unit } from "@ksp-gonogo/ui-kit";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactNode } from "react";
import { withGonogoFrame } from "../../frame";
import { held, live } from "../../readings";

function Column({
  width = 380,
  children,
}: {
  width?: number;
  children: ReactNode;
}) {
  return <div style={{ width }}>{children}</div>;
}

/** A caption line under a meter, quieter than the figures above it. */
function Caption({ children }: { children: ReactNode }) {
  return (
    <span
      style={{
        color: "var(--color-text-muted)",
        fontSize: "var(--font-size-caption)",
      }}
    >
      {children}
    </span>
  );
}

const meta = {
  title: "ui-kit/MeterRowGroup",
  component: MeterRowGroup,
  decorators: [
    (Story) => (
      <Column>
        <Story />
      </Column>
    ),
    withGonogoFrame,
  ],
} satisfies Meta<typeof MeterRowGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A staging list: each stage's fuel meter carries a burn-time caption, and every bar still lines up with the others. */
export const StagesWithCaptions: Story = {
  render: () => (
    <MeterStack>
      <MeterRowGroup>
        <Meter
          layout="row"
          label="S3 · Terrier"
          value={live("units", 360)}
          capacity={live("units", 400)}
        />
        <Caption>
          Burn 2m 14s · TWR 0.9 · ΔV <Unit value={value("m/s", 1_840)} />
        </Caption>
      </MeterRowGroup>
      <MeterRowGroup>
        <Meter
          layout="row"
          label="S2 · Swivel"
          value={live("units", 1_260)}
          capacity={live("units", 3_600)}
        />
        <Caption>
          Burn 58s · TWR 1.6 · ΔV <Unit value={value("m/s", 1_120)} />
        </Caption>
      </MeterRowGroup>
      <MeterRowGroup>
        <Meter
          layout="row"
          label="S1 · Kickback SRB"
          value={held("units", 180)}
          capacity={live("units", 1_000)}
          tone="warn"
        />
        <Caption>Burn 12s · TWR 2.4 · separation armed</Caption>
      </MeterRowGroup>
    </MeterStack>
  ),
};

/** Grouped rows and plain rows in one stack share the same columns. */
export const MixedWithPlainRows: Story = {
  render: () => (
    <MeterStack>
      <Meter
        layout="row"
        label="Electric charge"
        value={live("units", 180)}
        capacity={live("units", 400)}
      />
      <MeterRowGroup>
        <Meter
          layout="row"
          label="Jeb · Dose"
          value={live("ratio", 0.39)}
          tone="warn"
        />
        <Caption>Jebediah Kerman · in Kerbin's inner belt</Caption>
      </MeterRowGroup>
      <Meter
        layout="row"
        label="Snacks"
        value={live("units", 42)}
        capacity={live("units", 50)}
      />
    </MeterStack>
  ),
};

/** Narrow enough that figures go under the bars: a grouped caption stays under its own meter. */
export const Narrow: Story = {
  decorators: [
    (Story) => (
      <Column width={220}>
        <Story />
      </Column>
    ),
  ],
  render: () => (
    <MeterStack>
      <MeterRowGroup>
        <Meter
          layout="row"
          label="S2 · Swivel"
          value={live("units", 1_260)}
          capacity={live("units", 3_600)}
        />
        <Caption>Burn 58s · TWR 1.6</Caption>
      </MeterRowGroup>
      <MeterRowGroup>
        <Meter
          layout="row"
          label="S1 · Kickback"
          value={live("units", 180)}
          capacity={live("units", 1_000)}
        />
        <Caption>Burn 12s · TWR 2.4</Caption>
      </MeterRowGroup>
    </MeterStack>
  ),
};
