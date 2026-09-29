import { Row, RowName, ScrollArea, Text } from "@ksp-gonogo/ui-kit";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactNode } from "react";
import { withGonogoFrame } from "../../frame";

function Tile({ height, children }: { height: number; children: ReactNode }) {
  return (
    <div
      style={{
        width: 360,
        height,
        display: "flex",
        flexDirection: "column",
        border: "1px solid var(--color-border-subtle)",
      }}
    >
      {children}
    </div>
  );
}

const PARTS = [
  "Mk1 Command Pod",
  "Mk16 Parachute",
  "Heat Shield (1.25m)",
  "FL-T400 Fuel Tank",
  "FL-T200 Fuel Tank",
  "LV-909 Terrier",
  "TD-12 Decoupler",
  "FL-T800 Fuel Tank",
  "LV-T45 Swivel",
  "Basic Fin",
  "AV-T1 Winglet",
  "Modular Girder Segment",
];

const meta = {
  title: "ui-kit/ScrollArea",
  component: ScrollArea,
  decorators: [withGonogoFrame],
} satisfies Meta<typeof ScrollArea>;

export default meta;
type Story = StoryObj<typeof meta>;

/** More rows than the tile holds: the body scrolls and a glow marks the hidden edge. */
export const Overflowing: Story = {
  render: () => (
    <Tile height={120}>
      <ScrollArea>
        {PARTS.map((part) => (
          <Row key={part}>
            <RowName>{part}</RowName>
          </Row>
        ))}
      </ScrollArea>
    </Tile>
  ),
};

/** Content that fits draws no glow at either edge. */
export const Fitting: Story = {
  render: () => (
    <Tile height={120}>
      <ScrollArea>
        <Text>Three parts aboard, all nominal.</Text>
      </ScrollArea>
    </Tile>
  ),
};
