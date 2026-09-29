import {
  Badge,
  Cluster,
  Panel,
  Section,
  SectionTitle,
  Stack,
  Text,
  Unit,
} from "@ksp-gonogo/ui-kit";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactNode } from "react";
import { withGonogoFrame } from "../../frame";
import { held, live } from "../../readings";

function Column({ children }: { children: ReactNode }) {
  return <div style={{ width: 360 }}>{children}</div>;
}

function Figure({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Cluster>
      <Text tone="muted">{label}</Text>
      {children}
    </Cluster>
  );
}

const meta = {
  title: "ui-kit/Section",
  component: Section,
  decorators: [
    (Story) => (
      <Column>
        <Story />
      </Column>
    ),
    withGonogoFrame,
  ],
} satisfies Meta<typeof Section>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A named group of resource rows under its heading. */
export const Resources: Story = {
  args: {
    title: "Resources",
    children: (
      <>
        <Figure label="Liquid fuel">
          <Unit value={live("units", 1_260)} />
        </Figure>
        <Figure label="Oxidizer">
          <Unit value={live("units", 1_540)} />
        </Figure>
        <Figure label="Electric charge">
          <Unit value={held("units", 180)} />
        </Figure>
      </>
    ),
  },
};

/** Several sections one after another, the way a widget body is divided. */
export const Several: Story = {
  render: () => (
    <Stack gap="section">
      <Section title="Orbit">
        <Figure label="Apoapsis">
          <Unit value={live("m", 86_900)} />
        </Figure>
        <Figure label="Periapsis">
          <Unit value={live("m", 71_400)} />
        </Figure>
      </Section>
      <Section title="Crew">
        <Figure label="Jebediah Kerman">
          <Badge severity="nominal">Pilot</Badge>
        </Figure>
        <Figure label="Bill Kerman">
          <Badge severity="nominal">Engineer</Badge>
        </Figure>
      </Section>
      <Section title="Comms">
        <Figure label="Link">
          <Badge severity="caution">Weak</Badge>
        </Figure>
      </Section>
    </Stack>
  ),
};

/** Sections handed to a panel, which lays them out and titles the whole. */
export const InAPanel: Story = {
  render: () => (
    <div style={{ height: 320, display: "flex" }}>
      <Panel
        panelTitle="Kerbal X"
        sections={[
          <Section key="orbit" title="Orbit">
            <Figure label="Altitude">
              <Unit value={live("m", 84_320)} />
            </Figure>
            <Figure label="Orbital speed">
              <Unit value={live("m/s", 2_246)} />
            </Figure>
          </Section>,
          <Section key="fuel" title="Fuel">
            <Figure label="Liquid fuel">
              <Unit value={live("units", 1_260)} />
            </Figure>
            <Figure label="Oxidizer">
              <Unit value={held("units", 1_540)} />
            </Figure>
          </Section>,
        ]}
      />
    </div>
  ),
};

/** Without a title the section is only a tight group of rows. */
export const Untitled: Story = {
  args: {
    children: (
      <>
        <Figure label="Stage">
          <Text>3 of 5</Text>
        </Figure>
        <Figure label="Delta-v remaining">
          <Unit value={live("m/s", 1_840)} />
        </Figure>
      </>
    ),
  },
};

/** A wider gap for a section whose children are groups rather than rows. */
export const WideGap: Story = {
  args: {
    title: "Stages",
    gap: "related",
    children: (
      <>
        <Stack gap="rows">
          <Text weight="semibold">Stage 2</Text>
          <Figure label="Delta-v">
            <Unit value={live("m/s", 1_840)} />
          </Figure>
        </Stack>
        <Stack gap="rows">
          <Text weight="semibold">Stage 1</Text>
          <Figure label="Delta-v">
            <Unit value={live("m/s", 2_310)} />
          </Figure>
        </Stack>
      </>
    ),
  },
};

/** A section built from `SectionTitle` by hand, with the hairline rule under its heading. */
export const RuledTitle: Story = {
  render: () => (
    <Stack gap="rows">
      <SectionTitle as="h4" $rule>
        Science
      </SectionTitle>
      <Figure label="Crew report · Mun">
        <Unit value={live("science", 12)} />
      </Figure>
      <Figure label="Surface sample · Mun">
        <Unit value={live("science", 28)} />
      </Figure>
    </Stack>
  ),
};
