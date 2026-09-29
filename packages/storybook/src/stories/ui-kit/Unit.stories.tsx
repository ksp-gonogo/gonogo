import { value } from "@ksp-gonogo/sitrep-sdk";
import { Unit } from "@ksp-gonogo/ui-kit";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactNode } from "react";
import { withGonogoFrame } from "../../frame";
import { absent, held, live, pending } from "../../readings";

function Column({ children }: { children: ReactNode }) {
  return <div style={{ width: 420 }}>{children}</div>;
}

/** A readout list: one labelled line per quantity. */
function Readouts({ children }: { children: ReactNode }) {
  return (
    <dl
      style={{
        display: "grid",
        gridTemplateColumns: "11rem 1fr",
        rowGap: "var(--gap-caption)",
        margin: 0,
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {children}
    </dl>
  );
}

function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt style={{ color: "var(--color-text-muted)" }}>{label}</dt>
      <dd style={{ margin: 0 }}>{children}</dd>
    </>
  );
}

const meta = {
  title: "ui-kit/Unit",
  component: Unit,
  decorators: [
    (Story) => (
      <Column>
        <Story />
      </Column>
    ),
    withGonogoFrame,
  ],
  args: { value: live("m", 84_320) },
} satisfies Meta<typeof Unit>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The four states a reading arrives in: current, held with the warning dot, pending and absent. */
export const Currency: Story = {
  render: () => (
    <Readouts>
      <Line label="Live altitude">
        <Unit value={live("m", 84_320)} />
      </Line>
      <Line label="Held altitude">
        <Unit value={held("m", 84_320)} />
      </Line>
      <Line label="Pending altitude">
        <Unit value={pending()} />
      </Line>
      <Line label="Absent altitude">
        <Unit value={absent()} />
      </Line>
    </Readouts>
  ),
};

/** A current reading, drawn with no mark. */
export const Live: Story = {};

/** The last observation after the link dropped, marked by the held dot and a hover caption. */
export const Held: Story = {
  args: { value: held("m", 84_320) },
};

/** Nothing has arrived: the null token, never blank space. */
export const Pending: Story = {
  args: { value: pending() },
};

/** The source confirmed there is no value: the null token again. */
export const Absent: Story = {
  args: { value: absent() },
};

/** Each unit picks its own rung on its ladder and its own symbol. */
export const Units: Story = {
  render: () => (
    <Readouts>
      <Line label="Altitude">
        <Unit value={value("m", 84_320)} />
      </Line>
      <Line label="Mun distance">
        <Unit value={value("m", 11_400_000)} />
      </Line>
      <Line label="Orbital speed">
        <Unit value={value("m/s", 2_274)} />
      </Line>
      <Line label="Vessel mass">
        <Unit value={value("kg", 18_450)} />
      </Line>
      <Line label="Skin temperature">
        <Unit value={value("K", 1_480)} />
      </Line>
      <Line label="Inclination">
        <Unit value={value("°", 6.2)} />
      </Line>
      <Line label="Throttle">
        <Unit value={value("ratio", 0.72)} />
      </Line>
      <Line label="Liquid fuel">
        <Unit value={value("units", 1_260)} />
      </Line>
      <Line label="Funds">
        <Unit value={value("f", 1_284_500)} />
      </Line>
      <Line label="Science">
        <Unit value={value("sci", 412)} />
      </Line>
      <Line label="Reputation">
        <Unit value={value("rep", 318)} />
      </Line>
      <Line label="Zero speed">
        <Unit value={value("m/s", 0)} />
      </Line>
    </Readouts>
  ),
};

/** The same altitude at several precisions, and pinned to a rung or shown in another unit. */
export const Precision: Story = {
  render: () => (
    <Readouts>
      <Line label="Default">
        <Unit value={value("m", 84_321.7)} />
      </Line>
      <Line label="decimals 0">
        <Unit value={value("m", 84_321.7)} decimals={0} />
      </Line>
      <Line label="decimals 3">
        <Unit value={value("m", 84_321.7)} decimals={3} />
      </Line>
      <Line label="format m">
        <Unit value={value("m", 84_321.7)} format="m" />
      </Line>
      <Line label="scale never">
        <Unit value={value("m", 84_321.7)} scale="never" />
      </Line>
      <Line label="scale scientific">
        <Unit value={value("m", 84_321.7)} scale="scientific" />
      </Line>
      <Line label="Speed as km/h">
        <Unit value={value("m/s", 2_274)} format="km/h" />
      </Line>
      <Line label="Kelvin as °C">
        <Unit value={value("K", 1_480)} as="°C" />
      </Line>
    </Readouts>
  ),
};

/** A held reading whose model publishes a band shows the interval beside the figure. */
export const HeldWithBand: Story = {
  render: () => (
    <Readouts>
      <Line label="Periapsis ± band">
        <Unit
          value={held("m", 14_200, { lo: 13_900, hi: 14_500, kind: "sigma1" })}
        />
      </Line>
      <Line label="Periapsis range">
        <Unit
          value={held("m", 14_200, { lo: 13_600, hi: 14_300, kind: "bound" })}
        />
      </Line>
      <Line label="Live with band">
        <Unit
          value={live("m", 14_200, { lo: 13_900, hi: 14_500, kind: "sigma1" })}
        />
      </Line>
    </Readouts>
  ),
};

/** The symbol scales and dims with the text around it, so a large figure keeps a proportionate unit. */
export const InheritsSize: Story = {
  render: () => (
    <div style={{ display: "grid", gap: "var(--gap-caption)" }}>
      <span style={{ fontSize: "var(--font-size-caption)" }}>
        <Unit value={live("m/s", 2_274)} />
      </span>
      <span>
        <Unit value={live("m/s", 2_274)} />
      </span>
      <span
        style={{
          fontSize: "var(--font-size-figure)",
          color: "var(--color-status-go-fg)",
        }}
      >
        <Unit value={live("m/s", 2_274)} />
      </span>
    </div>
  ),
};
