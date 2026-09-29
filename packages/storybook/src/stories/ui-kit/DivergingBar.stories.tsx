import { type Reading, type Value, value } from "@ksp-gonogo/sitrep-sdk";
import { DivergingBar, Unit } from "@ksp-gonogo/ui-kit";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactNode } from "react";
import { withGonogoFrame } from "../../frame";
import { held, live, pending } from "../../readings";

/** The bar hides itself outside an inline-size container, so the column is one, as a Panel body is. */
function Column({
  width = 360,
  children,
}: {
  width?: number;
  children: ReactNode;
}) {
  return <div style={{ width, containerType: "inline-size" }}>{children}</div>;
}

interface Term {
  label: string;
  rate: Reading<Value<string>>;
}

/** One ledger line: the term's name, its bar, and the figure that carries the reading. */
function LedgerLine({ label, rate, maxAbs }: Term & { maxAbs: Value<string> }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr auto 7rem",
        alignItems: "center",
        gap: "var(--gap-figure-parts)",
        fontVariantNumeric: "tabular-nums",
      }}
    >
      <span>{label}</span>
      <DivergingBar value={rate} maxAbs={maxAbs} />
      <span style={{ textAlign: "end" }}>
        <Unit value={rate} />
      </span>
    </div>
  );
}

function Ledger({ terms, maxAbs }: { terms: Term[]; maxAbs: Value<string> }) {
  return (
    <div style={{ display: "grid", gap: "var(--gap-caption)" }}>
      {terms.map((term) => (
        <LedgerLine key={term.label} {...term} maxAbs={maxAbs} />
      ))}
    </div>
  );
}

const CHARGE_TERMS: Term[] = [
  { label: "OX-STAT solar panels", rate: live("units/s", 2.4) },
  { label: "Fuel cell array", rate: live("units/s", 1.5) },
  { label: "Reaction wheels", rate: live("units/s", -0.6) },
  { label: "Communotron 88-88", rate: live("units/s", -1.8) },
  { label: "Probe core", rate: live("units/s", -0.05) },
];

const meta = {
  title: "ui-kit/DivergingBar",
  component: DivergingBar,
  decorators: [
    (Story) => (
      <Column>
        <Story />
      </Column>
    ),
    withGonogoFrame,
  ],
  args: { value: live("units/s", 2.4), maxAbs: value("units/s", 2.4) },
} satisfies Meta<typeof DivergingBar>;

export default meta;
type Story = StoryObj<typeof meta>;

/** An electric charge ledger: producers grow right in green, consumers left in red, all scaled to the largest term. */
export const ChargeLedger: Story = {
  render: () => <Ledger terms={CHARGE_TERMS} maxAbs={value("units/s", 2.4)} />,
};

/** A producing term grows rightward from the zero line. */
export const Producing: Story = {
  render: (args) => (
    <LedgerLine
      label="OX-STAT solar panels"
      {...args}
      rate={live("units/s", 2.4)}
    />
  ),
};

/** A consuming term grows leftward from the zero line. */
export const Consuming: Story = {
  render: (args) => (
    <LedgerLine
      label="Communotron 88-88"
      {...args}
      rate={live("units/s", -1.8)}
    />
  ),
};

/** A term at the scale reaches the track's half-width; a larger one is clamped there. */
export const AtAndPastScale: Story = {
  render: () => (
    <Ledger
      maxAbs={value("units/s", 2)}
      terms={[
        { label: "At scale", rate: live("units/s", 2) },
        { label: "Past scale", rate: live("units/s", 3.6) },
        { label: "Past scale, drawing", rate: live("units/s", -3.6) },
      ]}
    />
  ),
};

/** A held term fades its fill; the figure beside it carries the held mark. */
export const Held: Story = {
  render: () => (
    <Ledger
      maxAbs={value("units/s", 2.4)}
      terms={[
        { label: "OX-STAT solar panels", rate: held("units/s", 2.4) },
        { label: "Reaction wheels", rate: held("units/s", -0.6) },
        { label: "Fuel cell array", rate: live("units/s", 1.5) },
      ]}
    />
  ),
};

/** A term with no figure yet draws an empty track, never a zero-width fill. */
export const Pending: Story = {
  render: () => (
    <Ledger
      maxAbs={value("units/s", 2.4)}
      terms={[
        { label: "OX-STAT solar panels", rate: live("units/s", 2.4) },
        { label: "RTG", rate: pending() },
      ]}
    />
  ),
};

/** A funds ledger for a career: contract income against facility upkeep. */
export const FundsLedger: Story = {
  render: () => (
    <Ledger
      maxAbs={value("f/day", 18_400)}
      terms={[
        { label: "Mun orbit contract", rate: live("f/day", 18_400) },
        { label: "Tourism: Kerbin flyby", rate: live("f/day", 6_200) },
        { label: "Facility upkeep", rate: live("f/day", -9_750) },
        { label: "Crew salaries", rate: live("f/day", -4_100) },
      ]}
    />
  ),
};

/** Below 300px of container the bars step aside and the figures alone remain. */
export const NarrowContainer: Story = {
  decorators: [
    (Story) => (
      <Column width={260}>
        <Story />
      </Column>
    ),
  ],
  render: () => <Ledger terms={CHARGE_TERMS} maxAbs={value("units/s", 2.4)} />,
};
