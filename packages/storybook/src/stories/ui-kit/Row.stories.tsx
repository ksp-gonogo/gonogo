import {
  Badge,
  GhostButton,
  Inline,
  Row,
  RowName,
  Text,
  Unit,
} from "@ksp-gonogo/ui-kit";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { type ReactNode, useState } from "react";
import { withGonogoFrame } from "../../frame";
import { held, live, pending } from "../../readings";

function Column({ children }: { children: ReactNode }) {
  return <div style={{ width: 360 }}>{children}</div>;
}

/** A bare list, the parent a `Row` renders its `li` into. */
function List({ children }: { children: ReactNode }) {
  return (
    <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>{children}</ul>
  );
}

const meta = {
  title: "ui-kit/Row",
  component: Row,
  decorators: [
    (Story) => (
      <Column>
        <Story />
      </Column>
    ),
    withGonogoFrame,
  ],
} satisfies Meta<typeof Row>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A list of vessels: each name on the left, its figure and status on the right. */
export const VesselList: Story = {
  render: () => (
    <List>
      <Row>
        <RowName>Kerbal X</RowName>
        <Unit value={live("m", 84_320)} />
        <Badge severity="nominal">Orbit</Badge>
      </Row>
      <Row>
        <RowName>Mun Lander II</RowName>
        <Unit value={live("m", 1_430)} />
        <Badge severity="warning">Descent</Badge>
      </Row>
      <Row>
        <RowName>Minmus Probe</RowName>
        <Unit value={held("m", 46_100)} />
        <Badge severity="offline">No signal</Badge>
      </Row>
      <Row>
        <RowName>Duna Relay</RowName>
        <Unit value={pending<"m">()} />
        <Badge severity="info">Launching</Badge>
      </Row>
    </List>
  ),
};

/** Nested rows: the tank lines under a stage total, inset on the left only. */
export const Nested: Story = {
  render: () => (
    <List>
      <Row>
        <RowName>Stage 2 · Liquid fuel</RowName>
        <Unit value={live("units", 3_600)} />
      </Row>
      <Row nested>
        <RowName>FL-T800 Fuel Tank</RowName>
        <Unit value={live("units", 1_800)} />
      </Row>
      <Row nested>
        <RowName>FL-T800 Fuel Tank</RowName>
        <Unit value={live("units", 1_800)} />
      </Row>
      <Row>
        <RowName>Stage 1 · Liquid fuel</RowName>
        <Unit value={held("units", 540)} />
      </Row>
    </List>
  ),
};

/** Wrapping rows in a narrow column: the trailing clusters drop to a second line instead of crushing the name. */
export const Wrap: Story = {
  decorators: [
    (Story) => (
      <div style={{ width: 220 }}>
        <Story />
      </div>
    ),
  ],
  render: () => (
    <List>
      <Row wrap>
        <RowName>Jebediah Kerman</RowName>
        <Inline>
          <Badge severity="nominal">Aboard</Badge>
          <Badge>Pilot</Badge>
          <GhostButton type="button" onClick={() => {}}>
            EVA
          </GhostButton>
        </Inline>
      </Row>
      <Row wrap>
        <RowName>Valentina Kerman</RowName>
        <Inline>
          <Badge severity="caution">EVA</Badge>
          <Badge>Pilot</Badge>
          <GhostButton type="button" onClick={() => {}}>
            Board
          </GhostButton>
        </Inline>
      </Row>
    </List>
  ),
};

/** The same narrow rows without `wrap`: the name yields its width to the clusters. */
export const NoWrap: Story = {
  decorators: Wrap.decorators,
  render: () => (
    <List>
      <Row>
        <RowName>Jebediah Kerman</RowName>
        <Inline>
          <Badge severity="nominal">Aboard</Badge>
          <Badge>Pilot</Badge>
          <GhostButton type="button" onClick={() => {}}>
            EVA
          </GhostButton>
        </Inline>
      </Row>
    </List>
  ),
};

const TARGETS = [
  { id: "mun", name: "Mun", distance: 11_400_000 },
  { id: "minmus", name: "Minmus", distance: 46_000_000 },
  { id: "kss", name: "KSS Harmony", distance: 182_000 },
] as const;

/** Interactive rows as buttons in a pick-one list: click one to select it, with hover and a focus ring. */
export const Interactive: Story = {
  render: function Render() {
    const [target, setTarget] = useState<string>("mun");
    return (
      <div>
        {TARGETS.map((body) => (
          <Row
            key={body.id}
            as="button"
            interactive
            selected={target === body.id}
            aria-pressed={target === body.id}
            onClick={() => setTarget(body.id)}
          >
            <RowName>{body.name}</RowName>
            <Unit value={live("m", body.distance)} />
          </Row>
        ))}
      </div>
    );
  },
};

/** A disabled interactive row beside an enabled one: the disabled one cannot be clicked or focused. */
export const Disabled: Story = {
  render: () => (
    <div>
      <Row as="button" interactive onClick={() => {}}>
        <RowName>Mun</RowName>
        <Text tone="muted">In range</Text>
      </Row>
      <Row as="button" interactive disabled onClick={() => {}}>
        <RowName>Eeloo</RowName>
        <Text tone="muted">No tracking</Text>
      </Row>
    </div>
  ),
};
