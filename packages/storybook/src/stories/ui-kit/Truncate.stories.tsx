import {
  Badge,
  Card,
  Cluster,
  Grid,
  Stack,
  Text,
  Truncate,
} from "@ksp-gonogo/ui-kit";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactNode } from "react";
import { withGonogoFrame } from "../../frame";

function Column({ children }: { children: ReactNode }) {
  return <div style={{ width: 300 }}>{children}</div>;
}

const meta = {
  title: "ui-kit/Truncate",
  component: Truncate,
  decorators: [
    (Story) => (
      <Column>
        <Story />
      </Column>
    ),
    withGonogoFrame,
  ],
} satisfies Meta<typeof Truncate>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A long vessel name beside a badge in a flex row: the name ellipsises and the badge stays whole. */
export const BesideBadge: Story = {
  render: () => (
    <Cluster>
      <Truncate>Mun Orbital Science Platform Mk II</Truncate>
      <Badge severity="nominal">Orbiting</Badge>
    </Cluster>
  ),
};

/** Names in fixed grid cells, each clipped to its own column. */
export const GridCells: Story = {
  render: () => (
    <Grid cols="1fr 1fr" gap="related">
      {[
        "Jebediah Kerman",
        "Valentina Kerman",
        "Bill Kerman",
        "Bob Kerman",
        "Gene Kerman, Flight Director",
        "Wernher von Kerman",
      ].map((name) => (
        <Cluster key={name}>
          <Truncate title={name}>{name}</Truncate>
        </Cluster>
      ))}
    </Grid>
  ),
};

/** A card title line built by hand, where a long contract name has to give way to its reward. */
export const CardTitleLine: Story = {
  render: () => (
    <Card>
      <Cluster>
        <Truncate>
          <Text weight="semibold">
            Rescue Jebediah Kerman from low orbit around Minmus
          </Text>
        </Truncate>
        <Badge severity="info">180 000 funds</Badge>
      </Cluster>
    </Card>
  ),
};

/** Short and long names together: only the ones that overflow are clipped. */
export const MixedLengths: Story = {
  render: () => (
    <Stack gap="rows">
      {["Mun", "Kerbal X", "Duna Ascent Vehicle and Return Stage"].map(
        (name) => (
          <Cluster key={name}>
            <Truncate>{name}</Truncate>
            <Text tone="muted">Kerbin SOI</Text>
          </Cluster>
        ),
      )}
    </Stack>
  ),
};
