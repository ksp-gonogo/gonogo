import { value } from "@ksp-gonogo/sitrep-sdk";
import { Badge, Card, Grid, Text, Truncate, Unit } from "@ksp-gonogo/ui-kit";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactNode } from "react";
import { withGonogoFrame } from "../../frame";
import { held, live, pending } from "../../readings";

function Column({ children }: { children: ReactNode }) {
  return <div style={{ width: 420 }}>{children}</div>;
}

const meta = {
  title: "ui-kit/Grid",
  component: Grid,
  decorators: [
    (Story) => (
      <Column>
        <Story />
      </Column>
    ),
    withGonogoFrame,
  ],
} satisfies Meta<typeof Grid>;

export default meta;
type Story = StoryObj<typeof meta>;

const CREW = [
  { name: "Jebediah Kerman", role: "Pilot", level: 3, state: "Aboard" },
  { name: "Bill Kerman", role: "Engineer", level: 2, state: "Aboard" },
  { name: "Bob Kerman", role: "Scientist", level: 1, state: "EVA" },
  { name: "Valentina Kerman", role: "Pilot", level: 4, state: "KSC" },
] as const;

/** A fixed column template: a crew roster whose name, role, level and state line up in columns. */
export const FixedColumns: Story = {
  args: {
    cols: "1fr 90px 40px 70px",
    children: CREW.flatMap((kerbal) => [
      <Truncate key={`${kerbal.name}-name`}>{kerbal.name}</Truncate>,
      <Text key={`${kerbal.name}-role`} level="muted">
        {kerbal.role}
      </Text>,
      <Text key={`${kerbal.name}-level`}>Lv {kerbal.level}</Text>,
      <Badge
        key={`${kerbal.name}-state`}
        tone={kerbal.state === "EVA" ? "caution" : "go"}
      >
        {kerbal.state}
      </Badge>,
    ]),
  },
};

/** A label/value grid on a shared baseline, with its rows tighter than its columns. */
export const LabelValue: Story = {
  args: {
    cols: "max-content 1fr",
    align: "baseline",
    gap: "related",
    rowGap: "rows",
    children: (
      <>
        <Text level="muted">Altitude</Text>
        <Text size="lg" weight="semibold">
          <Unit value={live("m", 84_320)} />
        </Text>
        <Text level="muted">Apoapsis</Text>
        <Unit value={live("m", 86_900)} />
        <Text level="muted">Periapsis</Text>
        <Unit value={held("m", 71_400)} />
        <Text level="muted">Time to Ap</Text>
        <Unit value={pending<"s">()} />
      </>
    ),
  },
};

const VESSELS = [
  { name: "Kerbal X", body: "Kerbin", altitude: 84_320, tone: "go" },
  { name: "Mun Lander II", body: "Mun", altitude: 1_430, tone: "warn" },
  { name: "Minmus Probe", body: "Minmus", altitude: 46_100, tone: "info" },
  { name: "Duna Relay", body: "Duna", altitude: 320_000, tone: "offline" },
  {
    name: "KSS Harmony",
    body: "Kerbin",
    altitude: 250_000,
    tone: "go",
  },
] as const;

/** Auto-filling columns: cards flow into as many columns as the width allows. */
export const AutoFillCards: Story = {
  args: {
    minColWidth: "120px",
    gap: "related",
    children: VESSELS.map((vessel) => (
      <Card
        key={vessel.name}
        title={vessel.name}
        titleRight={<Badge tone={vessel.tone}>{vessel.body}</Badge>}
      >
        <Unit value={value("m", vessel.altitude)} />
      </Card>
    )),
  },
};

/** The same cards in a narrow column: fewer columns, the same card width floor. */
export const AutoFillNarrow: Story = {
  decorators: [
    (Story) => (
      <div style={{ width: 260 }}>
        <Story />
      </div>
    ),
  ],
  args: AutoFillCards.args,
};

/** Top alignment, for rows whose cells differ in height. */
export const AlignStart: Story = {
  args: {
    cols: "max-content 1fr",
    align: "start",
    gap: "related",
    rowGap: "rows",
    children: (
      <>
        <Text level="muted">Objective</Text>
        <Text>Land on the Mun and return Jebediah Kerman to Kerbin</Text>
        <Text level="muted">Reward</Text>
        <Unit value={value("funds", 180_000)} />
      </>
    ),
  },
};
