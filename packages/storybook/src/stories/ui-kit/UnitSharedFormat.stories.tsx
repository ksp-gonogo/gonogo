import { value } from "@ksp-gonogo/sitrep-sdk";
import { Unit, UnitSharedFormat } from "@ksp-gonogo/ui-kit";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactNode } from "react";
import { withGonogoFrame } from "../../frame";
import { held, live } from "../../readings";

function Column({ children }: { children: ReactNode }) {
  return <div style={{ width: 560 }}>{children}</div>;
}

/** Two columns: each quantity on its own, and the same quantities inside a scope. */
function Compare({
  scoped,
  children,
}: {
  scoped: (children: ReactNode) => ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: "var(--gap-related)",
        fontVariantNumeric: "tabular-nums",
      }}
    >
      <Heading>Alone</Heading>
      <Heading>In a shared format</Heading>
      <div style={{ display: "grid", gap: "var(--gap-caption)" }}>
        {children}
      </div>
      <div style={{ display: "grid", gap: "var(--gap-caption)" }}>
        {scoped(children)}
      </div>
    </div>
  );
}

function Heading({ children }: { children: ReactNode }) {
  return (
    <span
      style={{
        color: "var(--color-text-muted)",
        fontSize: "var(--font-size-caption)",
        textTransform: "uppercase",
        letterSpacing: "0.08em",
      }}
    >
      {children}
    </span>
  );
}

function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span>
      <span style={{ color: "var(--color-text-muted)" }}>{label} </span>
      {children}
    </span>
  );
}

const meta = {
  title: "ui-kit/UnitSharedFormat",
  component: UnitSharedFormat,
  decorators: [
    (Story) => (
      <Column>
        <Story />
      </Column>
    ),
    withGonogoFrame,
  ],
} satisfies Meta<typeof UnitSharedFormat>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A flight's heights: alone each picks its own rung, in a scope they all read at the largest member's. */
export const OneInstrument: Story = {
  render: () => (
    <Compare scoped={(c) => <UnitSharedFormat>{c}</UnitSharedFormat>}>
      <Line label="Terrain">
        <Unit value={live("m", 850)} />
      </Line>
      <Line label="Altitude">
        <Unit value={live("m", 84_320)} />
      </Line>
      <Line label="Apoapsis">
        <Unit value={live("m", 112_600)} />
      </Line>
    </Compare>
  ),
};

/** An interval whose ends would print the same figure is widened until they read apart. */
export const Separate: Story = {
  render: () => (
    <Compare scoped={(c) => <UnitSharedFormat separate>{c}</UnitSharedFormat>}>
      <Line label="Transfer window">
        <Unit value={value("m", 6_700_000)} /> to{" "}
        <Unit value={value("m", 6_710_000)} />
      </Line>
    </Compare>
  ),
};

/** Grouping is per kind: lengths settle with lengths and masses with masses in the same scope. */
export const PerKind: Story = {
  render: () => (
    <Compare scoped={(c) => <UnitSharedFormat>{c}</UnitSharedFormat>}>
      <Line label="Kerbal X wet">
        <Unit value={value("kg", 18_450)} />
      </Line>
      <Line label="Kerbal X dry">
        <Unit value={value("kg", 900)} />
      </Line>
      <Line label="Apoapsis">
        <Unit value={value("m", 2_500_000)} />
      </Line>
      <Line label="Periapsis">
        <Unit value={value("m", 71_000)} />
      </Line>
    </Compare>
  ),
};

/** Pins for several groups at once: lengths in km and masses in tonnes. */
export const PinnedGroups: Story = {
  render: () => (
    <Compare
      scoped={(c) => (
        <UnitSharedFormat
          pins={{ length: { format: "km" }, mass: { format: "t" } }}
        >
          {c}
        </UnitSharedFormat>
      )}
    >
      <Line label="Altitude">
        <Unit value={value("m", 999)} />
      </Line>
      <Line label="Mun distance">
        <Unit value={value("m", 11_400_000)} />
      </Line>
      <Line label="Payload">
        <Unit value={value("kg", 500)} />
      </Line>
    </Compare>
  ),
};

/** One kind pinned with of: speeds shown in km/s, the lengths beside them left to settle. */
export const PinnedOneKind: Story = {
  render: () => (
    <Compare
      scoped={(c) => (
        <UnitSharedFormat of="m/s" format="km/s" decimals={3}>
          {c}
        </UnitSharedFormat>
      )}
    >
      <Line label="Orbital speed">
        <Unit value={value("m/s", 2_274)} />
      </Line>
      <Line label="Surface speed">
        <Unit value={value("m/s", 174)} />
      </Line>
      <Line label="Altitude">
        <Unit value={value("m", 84_320)} />
      </Line>
    </Compare>
  ),
};

/** Members that print the symbol once: 1 260/3 600 units rather than the unit on both. */
export const SymbolOnce: Story = {
  render: () => (
    <Compare scoped={(c) => <UnitSharedFormat>{c}</UnitSharedFormat>}>
      <Line label="Liquid fuel">
        <Unit value={live("units", 1_260)} hideUnitInGroup />/
        <Unit value={live("units", 3_600)} />
      </Line>
      <Line label="Oxidizer">
        <Unit value={held("units", 1_540)} hideUnitInGroup />/
        <Unit value={live("units", 4_400)} />
      </Line>
    </Compare>
  ),
};
