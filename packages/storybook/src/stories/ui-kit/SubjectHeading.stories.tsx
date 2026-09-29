import { Badge, Section, Stack, SubjectHeading } from "@ksp-gonogo/ui-kit";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactNode } from "react";
import { withGonogoFrame } from "../../frame";

function Column({ children }: { children: ReactNode }) {
  return <div style={{ width: 360 }}>{children}</div>;
}

const meta = {
  title: "ui-kit/SubjectHeading",
  component: SubjectHeading,
  decorators: [
    (Story) => (
      <Column>
        <Story />
      </Column>
    ),
    withGonogoFrame,
  ],
  args: {
    children: <strong>Mun Orbital Survey</strong>,
    status: <Badge severity="nominal">Active</Badge>,
  },
} satisfies Meta<typeof SubjectHeading>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A list of contracts, each subject first with its state pushed to the end of the line. */
export const ContractList: Story = {
  render: () => (
    <Section title="Contracts">
      <Stack gap="related">
        <SubjectHeading status={<Badge severity="nominal">Active</Badge>}>
          <strong>Mun Orbital Survey</strong>
        </SubjectHeading>
        <SubjectHeading status={<Badge severity="caution">Deadline 3d</Badge>}>
          <strong>Rescue Jebediah Kerman from Kerbin orbit</strong>
        </SubjectHeading>
        <SubjectHeading status={<Badge severity="critical">Failed</Badge>}>
          <strong>Test RT-10 Hammer at Minmus</strong>
        </SubjectHeading>
        <SubjectHeading>
          <strong>Explore Duna</strong>
        </SubjectHeading>
      </Stack>
    </Section>
  ),
};

/** One subject beside a single state badge. */
export const WithStatus: Story = {};

/** No state worth showing: the subject stands alone, with no gap left for a badge. */
export const SubjectOnly: Story = {
  args: { status: undefined, children: <strong>Kerbin Space Station</strong> },
};

/** A short run of states after the subject. */
export const SeveralStates: Story = {
  args: {
    children: <strong>Kerbal X</strong>,
    status: (
      <>
        <Badge severity="info">Sub-orbital</Badge>
        <Badge severity="caution">Low EC</Badge>
      </>
    ),
  },
};

/** A long subject in a narrow column: the badge drops onto a line of its own rather than squeezing the name. */
export const LongSubjectWraps: Story = {
  decorators: [
    (Story) => (
      <div style={{ width: 200 }}>
        <Story />
      </div>
    ),
  ],
  args: {
    children: (
      <strong>Place a science outpost on the Mun's northern pole</strong>
    ),
    status: <Badge severity="caution">Offered</Badge>,
  },
};
