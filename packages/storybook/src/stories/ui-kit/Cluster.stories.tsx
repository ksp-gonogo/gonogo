import { value } from "@ksp-gonogo/sitrep-sdk";
import {
  Badge,
  Button,
  Cluster,
  Stack,
  Text,
  Truncate,
  Unit,
} from "@ksp-gonogo/ui-kit";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactNode } from "react";
import { withGonogoFrame } from "../../frame";

function Column({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        width: 360,
        display: "flex",
        flexDirection: "column",
        gap: "var(--gap-section)",
      }}
    >
      {children}
    </div>
  );
}

/** A visible outline so the row's extent, and so its justification, can be seen. */
function Outline({ children }: { children: ReactNode }) {
  return (
    <div style={{ border: "1px dashed var(--color-border-subtle)" }}>
      {children}
    </div>
  );
}

const meta = {
  title: "ui-kit/Cluster",
  component: Cluster,
  decorators: [
    (Story) => (
      <Column>
        <Story />
      </Column>
    ),
    withGonogoFrame,
  ],
} satisfies Meta<typeof Cluster>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Each justification on the same three controls, outlined so the row's width shows. */
export const Justify: Story = {
  render: () => (
    <Stack gap="section">
      {(["between", "start", "center", "end"] as const).map((justify) => (
        <Stack key={justify} gap="caption">
          <Text size="xs" level="faint">
            justify={justify}
          </Text>
          <Outline>
            <Cluster justify={justify}>
              <Button variant="ghost" type="button" onClick={() => {}}>
                Abort
              </Button>
              <Button type="button" onClick={() => {}}>
                Stage
              </Button>
              <Button type="button" onClick={() => {}}>
                SAS
              </Button>
            </Cluster>
          </Outline>
        </Stack>
      ))}
    </Stack>
  ),
};

/** The default: a name pushed to one end and its status to the other. */
export const SpreadBetween: Story = {
  args: {
    children: (
      <>
        <Text weight="semibold">Kerbal X</Text>
        <Badge tone="go">In orbit</Badge>
      </>
    ),
  },
};

/** A truncating name gives way to the badges beside it rather than pushing them out of the row. */
export const TruncatingName: Story = {
  decorators: [
    (Story) => (
      <div style={{ width: 220 }}>
        <Story />
      </div>
    ),
  ],
  args: {
    children: (
      <>
        <Truncate>Mun Orbital Science Platform Mk II</Truncate>
        <Badge tone="caution">Low EC</Badge>
      </>
    ),
  },
};

/** Baseline alignment: a large figure and its small caption share one baseline. */
export const Baseline: Story = {
  args: {
    align: "baseline",
    justify: "start",
    children: (
      <>
        <Text size="lg" weight="semibold">
          <Unit value={value("m", 84_320)} />
        </Text>
        <Text size="xs" level="muted">
          altitude above Kerbin
        </Text>
      </>
    ),
  },
};

/** Start alignment, for a label beside content that wraps taller than the label. */
export const AlignStart: Story = {
  args: {
    align: "start",
    children: (
      <>
        <Text level="muted">Notes</Text>
        <Text style={{ maxWidth: 220 }}>
          Circularise at apoapsis, then hold prograde until the Mun transfer
          window opens in 14 minutes.
        </Text>
      </>
    ),
  },
};

/** A chip strip that opts into wrapping, so a long list of tags breaks onto further lines. */
export const Wrap: Story = {
  decorators: [
    (Story) => (
      <Outline>
        <Story />
      </Outline>
    ),
  ],
  args: {
    wrap: true,
    justify: "start",
    children: (
      <>
        {[
          "Kerbin",
          "Mun",
          "Minmus",
          "Duna",
          "Ike",
          "Eve",
          "Gilly",
          "Jool",
          "Laythe",
          "Tylo",
        ].map((body) => (
          <Badge key={body}>{body}</Badge>
        ))}
      </>
    ),
  },
};

/** The same strip without `wrap`: it stays one line and runs past its column. */
export const NoWrap: Story = {
  decorators: Wrap.decorators,
  args: { ...Wrap.args, wrap: false },
};

/** Gap jobs, from packed to comfortable, on the same row of badges. */
export const Gaps: Story = {
  render: () => (
    <Stack gap="section">
      {(["related-packed", "related-dense", "related", "section"] as const).map(
        (gap) => (
          <Stack key={gap} gap="caption">
            <Text size="xs" level="faint">
              gap={gap}
            </Text>
            <Cluster gap={gap} justify="start">
              <Badge tone="go">GO</Badge>
              <Badge tone="caution">HOLD</Badge>
              <Badge tone="nogo">NO-GO</Badge>
            </Cluster>
          </Stack>
        ),
      )}
    </Stack>
  ),
};
