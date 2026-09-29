import { value } from "@ksp-gonogo/sitrep-sdk";
import { Band, Grid, Text } from "@ksp-gonogo/ui-kit";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactNode } from "react";
import { withGonogoFrame } from "../../frame";

function Column({ children }: { children: ReactNode }) {
  return <div style={{ width: 360 }}>{children}</div>;
}

const meta = {
  title: "ui-kit/Band",
  component: Band,
  decorators: [
    (Story) => (
      <Column>
        <Story />
      </Column>
    ),
    withGonogoFrame,
  ],
} satisfies Meta<typeof Band>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A tracking station's orbital elements, each drawn as its interval beside its label. */
export const OrbitalElements: Story = {
  render: () => (
    <Grid cols="max-content 1fr" align="baseline" rowGap="rows" gap="related">
      <Text tone="muted">Apoapsis</Text>
      <Band min={value("m", 84_200)} max={value("m", 86_900)} />
      <Text tone="muted">Periapsis</Text>
      <Band min={value("m", 71_400)} max={value("m", 72_100)} />
      <Text tone="muted">Inclination</Text>
      <Band min={value("°", 5.8)} max={value("°", 6.4)} wrapsAt={360} />
      <Text tone="muted">Arg. of periapsis</Text>
      <Band min={value("°", 12)} max={value("°", 250)} wrapsAt={360} />
      <Text tone="muted">Orbital speed</Text>
      <Band min={value("m/s", 2_238)} max={value("m/s", 2_271)} />
    </Grid>
  ),
};

/** Two ends far apart: each keeps the unit's own precision. */
export const Wide: Story = {
  args: { min: value("m", 1_200), max: value("m", 8_400) },
};

/** A narrow band on a large figure: digits widen until the ends differ, so it never prints the same figure twice. */
export const Narrow: Story = {
  args: { min: value("m", 6_700_000), max: value("m", 6_710_000) },
};

/** Ends that straddle a rung are both written on the larger end's rung. */
export const StraddlesRung: Story = {
  args: { min: value("m", 999), max: value("m", 1_000) },
};

/** Ends the display cannot tell apart are drawn once, marked approximate. */
export const Approximate: Story = {
  args: { min: value("m", 65_286.8), max: value("m", 65_286.8) },
};

/** A circular quantity that swept half a turn or more reads as precessing, not as an interval. */
export const Precesses: Story = {
  args: { min: value("°", 10), max: value("°", 250), wrapsAt: 360 },
};

/** A band with one end missing is absent: the null token, never a lone scalar. */
export const HalfAbsent: Story = {
  args: { min: value("m", 71_400), max: null },
};
