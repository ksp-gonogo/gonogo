import { ExpandableText, Section, Stack } from "@ksp-gonogo/ui-kit";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactNode } from "react";
import { withGonogoFrame } from "../../frame";

function Column({ children }: { children: ReactNode }) {
  return <div style={{ width: 360 }}>{children}</div>;
}

const BRIEFING =
  "We need someone to go take a look at the Mun. Plant a flag, snap a few pictures, collect a surface sample and bring Jebediah Kerman home in one piece. Our accountants insist the return trip is not optional this time, and the insurance people have asked us to stop calling the lander 'probably fine'.";

const OBJECTIVES =
  "Reach orbit around the Mun with a periapsis below 30 km. Land within 5 km of the marked crater rim. Transmit or recover a surface sample. Return the crew to Kerbin and splash down in the ocean east of KSC.";

const meta = {
  title: "ui-kit/ExpandableText",
  component: ExpandableText,
  decorators: [
    (Story) => (
      <Column>
        <Story />
      </Column>
    ),
    withGonogoFrame,
  ],
  args: { children: BRIEFING, subject: "Briefing" },
} satisfies Meta<typeof ExpandableText>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A contract's two prose fields, each named by its subject so the buttons announce "Show more of Briefing" and "Show more of Objectives". */
export const ContractProse: Story = {
  render: () => (
    <Stack gap="section">
      <Section title="Briefing">
        <ExpandableText subject="Briefing">{BRIEFING}</ExpandableText>
      </Section>
      <Section title="Objectives">
        <ExpandableText subject="Objectives">{OBJECTIVES}</ExpandableText>
      </Section>
    </Stack>
  ),
};

/** Game prose past the limit: cut on a whole word, the rest one press away. */
export const Cut: Story = {};

/** Text only a little over the limit stands whole, since the button would cost more than the tail. */
export const ShortStandsWhole: Story = {
  args: {
    children:
      "Put a satellite into a stable orbit of Kerbin above 70 km. Any probe core will do.",
  },
};

/** A tighter limit for a narrow row: the cut comes sooner. */
export const TightLimit: Story = {
  args: { limit: 60 },
};

/** No subject given: the button reads only "Show more", with nothing to tell two of them apart to a screen reader. */
export const WithoutSubject: Story = {
  args: { subject: undefined },
};
