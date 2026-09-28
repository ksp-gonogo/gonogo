import {
  Badge,
  Button,
  Cluster,
  Inline,
  Stack,
  Text,
  Truncate,
} from "@ksp-gonogo/ui-kit";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactNode } from "react";
import { withGonogoFrame } from "../../frame";

function Column({ children }: { children: ReactNode }) {
  return <div style={{ width: 360 }}>{children}</div>;
}

const meta = {
  title: "ui-kit/Inline",
  component: Inline,
  decorators: [
    (Story) => (
      <Column>
        <Story />
      </Column>
    ),
    withGonogoFrame,
  ],
} satisfies Meta<typeof Inline>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A vessel's status badges held together as one run that never yields width to the name beside it. */
export const BesideTruncatingName: Story = {
  render: () => (
    <Cluster>
      <Truncate>Mun Orbital Science Platform Mk II</Truncate>
      <Inline>
        <Badge tone="go">Orbiting</Badge>
        <Badge tone="caution">Low EC</Badge>
        <Badge>3 crew</Badge>
      </Inline>
    </Cluster>
  ),
};

/** A badge run followed by an action run, set apart by `inset`. */
export const Inset: Story = {
  render: () => (
    <Cluster>
      <Text weight="semibold">Kerbal X</Text>
      <span>
        <Inline>
          <Badge tone="warn">Burn in 2 min</Badge>
        </Inline>
        <Inline inset>
          <Button variant="ghost" type="button" onClick={() => {}}>
            Warp
          </Button>
          <Button type="button" onClick={() => {}}>
            Focus
          </Button>
        </Inline>
      </span>
    </Cluster>
  ),
};

const BODIES = ["Kerbin", "Mun", "Minmus", "Duna", "Ike", "Eve", "Jool"];

/** A data-driven run that wraps, so a long list breaks inside a narrow column. */
export const Wrap: Story = {
  decorators: [
    (Story) => (
      <div
        style={{ width: 200, border: "1px dashed var(--color-border-subtle)" }}
      >
        <Story />
      </div>
    ),
  ],
  args: {
    wrap: true,
    children: BODIES.map((body) => <Badge key={body}>{body}</Badge>),
  },
};

/** The same run without `wrap`: one unbreakable line that runs past the column. */
export const NoWrap: Story = {
  decorators: Wrap.decorators,
  args: { ...Wrap.args, wrap: false },
};

/** Gap jobs on the same run of badges. */
export const Gaps: Story = {
  render: () => (
    <Stack gap="section">
      {(["related-packed", "related-dense", "related", "section"] as const).map(
        (gap) => (
          <Stack key={gap} gap="caption">
            <Text size="xs" level="faint">
              gap={gap}
            </Text>
            <Inline gap={gap}>
              <Badge tone="go">GO</Badge>
              <Badge tone="caution">HOLD</Badge>
              <Badge tone="nogo">NO-GO</Badge>
            </Inline>
          </Stack>
        ),
      )}
    </Stack>
  ),
};
