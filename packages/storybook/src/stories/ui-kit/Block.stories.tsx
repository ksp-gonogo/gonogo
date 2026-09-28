import {
  Badge,
  Block,
  Button,
  Cluster,
  Stack,
  Text,
  Unit,
} from "@ksp-gonogo/ui-kit";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactNode } from "react";
import { withGonogoFrame } from "../../frame";
import { held, live } from "../../readings";

function Column({ children }: { children: ReactNode }) {
  return <div style={{ width: 420 }}>{children}</div>;
}

const meta = {
  title: "ui-kit/Block",
  component: Block,
  decorators: [
    (Story) => (
      <Column>
        <Story />
      </Column>
    ),
    withGonogoFrame,
  ],
} satisfies Meta<typeof Block>;

export default meta;
type Story = StoryObj<typeof meta>;

function Figure({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Cluster>
      <Text level="muted">{label}</Text>
      {children}
    </Cluster>
  );
}

/** A full vessel record: name, status badges on its line, figures in the body and actions in the footer. */
export const VesselRecord: Story = {
  args: {
    title: "Kerbal X",
    titleRight: (
      <>
        <Badge tone="go">In orbit</Badge>
        <Badge tone="caution">Low EC</Badge>
      </>
    ),
    footer: (
      <>
        <Text level="muted">Kerbin · 3 crew</Text>
        <Cluster justify="end">
          <Button variant="ghost" type="button" onClick={() => {}}>
            Focus
          </Button>
          <Button type="button" onClick={() => {}}>
            Plan burn
          </Button>
        </Cluster>
      </>
    ),
    children: (
      <Stack gap="rows">
        <Figure label="Altitude">
          <Unit value={live("m", 84_320)} />
        </Figure>
        <Figure label="Orbital speed">
          <Unit value={live("m/s", 2_246)} />
        </Figure>
        <Figure label="Liquid fuel">
          <Unit value={held("units", 1_260)} />
        </Figure>
      </Stack>
    ),
  },
};

/** A lead-in before the name, such as a rank or an index, on the name's own line. */
export const TitleLead: Story = {
  args: {
    title: "Jebediah Kerman",
    titleLeft: <Text tone="go">1</Text>,
    titleRight: <Badge tone="info">Pilot · Lv 3</Badge>,
    children: <Text level="muted">Assigned to Kerbal X, command seat</Text>,
  },
};

/** Asides beside the body: they sit on either side while there is room for both. */
export const SideAsides: Story = {
  args: {
    title: "Mun Relay 1",
    left: <Badge tone="go">Link</Badge>,
    right: <Unit value={live("m", 2_870_000)} />,
    children: (
      <Stack gap="rows">
        <Text>Keostationary relay over the Mun</Text>
        <Text level="muted">Signal strength 82 %</Text>
      </Stack>
    ),
  },
};

/** The same asides in a narrow column: the left one moves above the body and the right one below. */
export const SideAsidesNarrow: Story = {
  decorators: [
    (Story) => (
      <div style={{ width: 180 }}>
        <Story />
      </div>
    ),
  ],
  args: SideAsides.args,
};

/** Content across the top and bottom, which is already stacked and never moves. */
export const TopAndBottom: Story = {
  args: {
    top: <Text level="faint">Contract · Explore the Mun</Text>,
    title: "Plant a flag on the Mun",
    children: <Text level="muted">Advance 42 000 funds, reward 180 000</Text>,
    bottom: <Badge tone="warn">Expires in 3 days</Badge>,
  },
};

/** A record of several blocks in a list, each with its own name and figures. */
export const Several: Story = {
  render: () => (
    <Stack gap="section">
      <Block title="Kerbal X" titleRight={<Badge tone="go">Orbiting</Badge>}>
        <Figure label="Altitude">
          <Unit value={live("m", 84_320)} />
        </Figure>
      </Block>
      <Block
        title="Mun Lander II"
        titleRight={<Badge tone="warn">Descent</Badge>}
      >
        <Figure label="Altitude">
          <Unit value={live("m", 1_430)} />
        </Figure>
      </Block>
      <Block
        title="Minmus Probe"
        titleRight={<Badge tone="offline">No signal</Badge>}
      >
        <Figure label="Altitude">
          <Unit value={held("m", 46_100)} />
        </Figure>
      </Block>
    </Stack>
  ),
};
