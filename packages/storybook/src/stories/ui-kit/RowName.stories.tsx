import { Badge, Inline, Row, RowName, Unit } from "@ksp-gonogo/ui-kit";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactNode } from "react";
import { withGonogoFrame } from "../../frame";
import { live } from "../../readings";

function Column({ children }: { children: ReactNode }) {
  return <div style={{ width: 300 }}>{children}</div>;
}

const meta = {
  title: "ui-kit/RowName",
  component: RowName,
  decorators: [
    (Story) => (
      <Column>
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          <Story />
        </ul>
      </Column>
    ),
    withGonogoFrame,
  ],
} satisfies Meta<typeof RowName>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A vessel name filling the row up to its figure and badge. */
export const InARow: Story = {
  render: () => (
    <Row>
      <RowName>Kerbal X</RowName>
      <Unit value={live("m", 84_320)} />
      <Badge severity="nominal">Orbit</Badge>
    </Row>
  ),
};

/** A name too long for the row ellipsises, and the trailing figures keep their width. */
export const Truncates: Story = {
  render: () => (
    <Row>
      <RowName>Mun Orbital Science Platform Mk II (Jebediah's Folly)</RowName>
      <Inline>
        <Unit value={live("m", 14_200)} />
        <Badge severity="caution">Low EC</Badge>
      </Inline>
    </Row>
  ),
};

/** Several names of different lengths: each takes the space left by its own row's clusters. */
export const SeveralLengths: Story = {
  render: () => (
    <>
      {[
        "Mun",
        "Kerbal X",
        "KSS Harmony Station Core",
        "Duna Ascent Vehicle and Return Stage",
      ].map((name) => (
        <Row key={name}>
          <RowName>{name}</RowName>
          <Badge>Kerbin SOI</Badge>
        </Row>
      ))}
    </>
  ),
};

/** Under a wrapping row the name keeps a readable floor and the badges drop below it. */
export const WrappingRow: Story = {
  render: () => (
    <Row wrap>
      <RowName>Bartbrey Kerman</RowName>
      <Inline>
        <Badge severity="nominal">Aboard</Badge>
        <Badge>Engineer</Badge>
        <Badge>Lv 2</Badge>
        <Badge severity="info">Trained</Badge>
      </Inline>
    </Row>
  ),
};
