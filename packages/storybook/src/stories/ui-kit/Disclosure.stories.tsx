import {
  Badge,
  Disclosure,
  InfoIcon,
  Row,
  Section,
  Stack,
  Unit,
} from "@ksp-gonogo/ui-kit";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactNode } from "react";
import { withGonogoFrame } from "../../frame";
import { live } from "../../readings";

function Column({ children }: { children: ReactNode }) {
  return <div style={{ width: 360, minHeight: 280 }}>{children}</div>;
}

const STAGE_DETAIL = (
  <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
    <Row>
      <Row.Name>Engine</Row.Name>
      <span>LV-T45 Swivel</span>
    </Row>
    <Row>
      <Row.Name>Thrust</Row.Name>
      <Unit value={live("kN", 215)} />
    </Row>
    <Row>
      <Row.Name>Burn time</Row.Name>
      <Unit value={live("s", 94)} />
    </Row>
    <Row>
      <Row.Name>Stage ΔV</Row.Name>
      <Unit value={live("m/s", 1_380)} />
    </Row>
  </ul>
);

const meta = {
  title: "ui-kit/Disclosure",
  component: Disclosure,
  decorators: [
    (Story) => (
      <Column>
        <Story />
      </Column>
    ),
    withGonogoFrame,
  ],
  args: {
    label: "Stage 2 detail",
    children: STAGE_DETAIL,
    variant: "inline",
  },
} satisfies Meta<typeof Disclosure>;

export default meta;
type Story = StoryObj<typeof meta>;

/** An accordion of stages: each expands in flow under its trigger, with a rotating chevron. */
export const InlineAccordion: Story = {
  render: () => (
    <Section title="Kerbal X staging">
      <Stack gap="related-dense">
        <Disclosure variant="inline" label="Stage 3: launch clamps">
          <span>TT18-A clamps release at ignition.</span>
        </Disclosure>
        <Disclosure variant="inline" label="Stage 2: core ascent" defaultOpen>
          {STAGE_DETAIL}
        </Disclosure>
        <Disclosure variant="inline" label="Stage 1: orbital insertion">
          {STAGE_DETAIL}
        </Disclosure>
      </Stack>
    </Section>
  ),
};

/** Closed on first draw: the trigger alone, detail on demand. */
export const Closed: Story = {};

/** Open from the start, for a panel whose detail is the main content. */
export const Open: Story = {
  args: { defaultOpen: true },
};

/** A label that reads differently once open, with no chevron and button chrome. */
export const WordedButton: Story = {
  args: {
    label: (open: boolean) => (open ? "Hide burn plan" : "Show burn plan"),
    chevron: false,
    asButton: true,
    buttonSize: "sm",
    defaultOpen: true,
  },
};

/** A compact hint over a glyph: the panel pops out over what follows. */
export const Popover: Story = {
  render: () => (
    <Row as="div">
      <Row.Name>Signal strength</Row.Name>
      <Badge severity="caution">Weak</Badge>
      <Disclosure
        variant="popover"
        label={<InfoIcon size={14} />}
        ariaLabel="About signal strength"
        defaultOpen
      >
        <span>Mun occludes the KSC dish for 18 minutes of each orbit.</span>
      </Disclosure>
    </Row>
  ),
};

/** A long panel inside a height cap: it scrolls rather than pushing the page. */
export const CappedHeight: Story = {
  args: {
    label: "Flight log",
    defaultOpen: true,
    children: (
      <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
        {[
          "Liftoff",
          "Tower cleared",
          "Gravity turn",
          "Max Q",
          "Booster separation",
          "Fairing jettison",
          "Stage 2 ignition",
          "MECO",
          "Circularisation",
          "Orbit achieved",
          "Solar panels deployed",
          "Antenna extended",
        ].map((event) => (
          <Row key={event}>
            <Row.Name>{event}</Row.Name>
          </Row>
        ))}
      </ul>
    ),
  },
};
