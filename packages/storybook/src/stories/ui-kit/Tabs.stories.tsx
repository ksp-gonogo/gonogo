import {
  Meter,
  MeterStack,
  Row,
  Section,
  Stat,
  StatStrip,
  type TabDescriptor,
  Tabs,
  Unit,
} from "@ksp-gonogo/ui-kit";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { type ReactNode, useState } from "react";
import { withGonogoFrame } from "../../frame";
import { live } from "../../readings";

function Column({ children }: { children: ReactNode }) {
  return <div style={{ width: 420 }}>{children}</div>;
}

const FLIGHT = (
  <Section>
    <StatStrip>
      <Stat label="Altitude">
        <Unit value={live("m", 71_240)} />
      </Stat>
      <Stat label="Vertical speed">
        <Unit value={live("m/s", 212)} />
      </Stat>
      <Stat label="Apoapsis">
        <Unit value={live("m", 82_400)} />
      </Stat>
    </StatStrip>
  </Section>
);

const RESOURCES = (
  <Section>
    <MeterStack>
      <Meter
        label="Liquid fuel"
        value={live("units", 1_260)}
        capacity={live("units", 3_600)}
      />
      <Meter
        label="Electric charge"
        value={live("units", 180)}
        capacity={live("units", 400)}
        tone="warn"
      />
    </MeterStack>
  </Section>
);

const CREW = (
  <Section>
    <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
      <Row>
        <Row.Name>Jebediah Kerman</Row.Name>
        <span>Pilot</span>
      </Row>
      <Row>
        <Row.Name>Bill Kerman</Row.Name>
        <span>Engineer</span>
      </Row>
    </ul>
  </Section>
);

const VESSEL_TABS: TabDescriptor[] = [
  { id: "flight", label: "Flight", content: FLIGHT },
  { id: "resources", label: "Resources", content: RESOURCES, indicator: true },
  { id: "crew", label: "Crew", content: CREW },
];

const meta = {
  title: "ui-kit/Tabs",
  component: Tabs,
  decorators: [
    (Story) => (
      <Column>
        <Story />
      </Column>
    ),
    withGonogoFrame,
  ],
  args: { tabs: VESSEL_TABS, "aria-label": "Kerbal X systems" },
} satisfies Meta<typeof Tabs>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Three subsystems of one vessel, one panel at a time; Resources carries an attention dot. Click or arrow between them. */
export const VesselSystems: Story = {};

/** Selection held by the caller: the readout under the strip follows the chosen tab. */
export const Controlled: Story = {
  render: (args) => {
    const [active, setActive] = useState("crew");
    return (
      <div>
        <Tabs {...args} activeId={active} onChange={setActive} />
        <p style={{ color: "var(--color-text-muted)" }}>Showing: {active}</p>
      </div>
    );
  },
};

/** A subsystem that does not apply right now: Target is skipped by the arrow keys and cannot be chosen. */
export const DisabledTab: Story = {
  args: {
    tabs: [
      ...VESSEL_TABS,
      { id: "target", label: "Target", content: FLIGHT, disabled: true },
    ],
  },
};

/** More tabs than the strip holds: the row tightens and scrolls, with a fade at the hidden edge. */
export const Crowded: Story = {
  args: {
    tabs: [
      { id: "flight", label: "Flight", content: FLIGHT },
      { id: "orbit", label: "Orbit", content: FLIGHT },
      { id: "resources", label: "Resources", content: RESOURCES },
      { id: "crew", label: "Crew", content: CREW },
      { id: "science", label: "Science", content: CREW },
      { id: "comms", label: "Comms", content: CREW, indicator: true },
      { id: "thermal", label: "Thermal", content: RESOURCES },
    ],
  },
};

/** Wide enough for every panel: they sit side by side, each under its own label, with no strip. */
export const ExpandedWhenRoomy: Story = {
  decorators: [
    (Story) => (
      <div style={{ width: 820 }}>
        <Story />
      </div>
    ),
  ],
  args: { expandWhenRoomy: true },
};
