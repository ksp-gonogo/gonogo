import { Badge, Card, Cluster, Stack, Text, Unit } from "@ksp-gonogo/ui-kit";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactNode } from "react";
import { withGonogoFrame } from "../../frame";
import { held, live } from "../../readings";

function Column({ children }: { children: ReactNode }) {
  return <div style={{ width: 360 }}>{children}</div>;
}

const meta = {
  title: "ui-kit/Stack",
  component: Stack,
  decorators: [
    (Story) => (
      <Column>
        <Story />
      </Column>
    ),
    withGonogoFrame,
  ],
} satisfies Meta<typeof Stack>;

export default meta;
type Story = StoryObj<typeof meta>;

const VESSELS = [
  { name: "Kerbal X", body: "Kerbin", altitude: live("m", 84_320) },
  { name: "Mun Lander II", body: "Mun", altitude: live("m", 1_430) },
  { name: "Minmus Probe", body: "Minmus", altitude: held("m", 46_100) },
];

/** A vertical list of vessel cards at the inherited gap. */
export const VesselList: Story = {
  args: {
    children: VESSELS.map((vessel) => (
      <Card
        key={vessel.name}
        title={vessel.name}
        titleRight={<Badge>{vessel.body}</Badge>}
      >
        <Cluster>
          <Text tone="muted">Altitude</Text>
          <Unit value={vessel.altitude} />
        </Cluster>
      </Card>
    )),
  },
};

/** Figures stacked at the tight `rows` gap, the spacing of a readout list. */
export const Rows: Story = {
  args: {
    gap: "rows",
    children: (
      <>
        <Cluster>
          <Text tone="muted">Liquid fuel</Text>
          <Unit value={live("units", 1_260)} />
        </Cluster>
        <Cluster>
          <Text tone="muted">Oxidizer</Text>
          <Unit value={live("units", 1_540)} />
        </Cluster>
        <Cluster>
          <Text tone="muted">Monopropellant</Text>
          <Unit value={held("units", 42)} />
        </Cluster>
        <Cluster>
          <Text tone="muted">Electric charge</Text>
          <Unit value={live("units", 180)} />
        </Cluster>
      </>
    ),
  },
};

/** Gap jobs side by side on the same three items. */
export const Gaps: Story = {
  render: () => (
    <Cluster align="start" justify="start" gap="section">
      {(["caption", "rows", "related", "section"] as const).map((gap) => (
        <Stack key={gap} gap="caption">
          <Text size="xs" tone="faint">
            {gap}
          </Text>
          <Stack gap={gap}>
            <Badge severity="nominal">Stage 3</Badge>
            <Badge severity="nominal">Stage 2</Badge>
            <Badge severity="caution">Stage 1</Badge>
          </Stack>
        </Stack>
      ))}
    </Cluster>
  ),
};

/** `fill` in a fixed-height column: the stack takes the leftover height and its list scrolls inside it. */
export const FillScrolls: Story = {
  render: () => (
    <div
      style={{
        height: 150,
        display: "flex",
        flexDirection: "column",
        gap: "var(--gap-related)",
        border: "1px dashed var(--color-border-subtle)",
      }}
    >
      <Text weight="semibold">Flight log · Kerbal X</Text>
      <Stack
        fill
        gap="rows"
        style={{ overflowY: "auto" }}
        tabIndex={0}
        role="region"
        aria-label="Flight log"
      >
        {[
          "T+00:00 Liftoff from KSC",
          "T+00:42 Gravity turn begun",
          "T+01:10 Max Q",
          "T+01:48 Booster separation",
          "T+02:30 Main engine cutoff",
          "T+02:34 Stage 2 ignition",
          "T+04:12 Apoapsis 86 km",
          "T+05:50 Coast to apoapsis",
          "T+06:40 Circularisation burn",
          "T+07:22 Orbit achieved",
        ].map((line) => (
          <Text key={line} size="sm">
            {line}
          </Text>
        ))}
      </Stack>
    </div>
  ),
};
