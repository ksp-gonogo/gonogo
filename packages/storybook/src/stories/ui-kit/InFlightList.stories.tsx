import { InFlightList, type InFlightListItem } from "@ksp-gonogo/ui-kit";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { type ReactNode, useState } from "react";
import { withGonogoFrame } from "../../frame";

function Column({ children }: { children: ReactNode }) {
  return <div style={{ width: 360 }}>{children}</div>;
}

/** One of each phase a command passes through on its way to Mun Lander II and back. */
const QUEUE: InFlightListItem[] = [
  {
    id: "sas-pro",
    label: "SAS Prograde",
    etaSeconds: 42,
    phase: "in-transit",
    progress: 0.12,
    glyph: "PRO",
  },
  {
    id: "stage",
    label: "Activate stage 3",
    etaSeconds: 95,
    phase: "awaiting-reply",
    progress: 0.45,
    glyph: "STG",
  },
  {
    id: "throttle",
    label: "Throttle to 60%",
    etaSeconds: 3,
    phase: "due",
    progress: 0.64,
    glyph: "THR",
  },
  {
    id: "warp",
    label: "Warp to Mun SOI",
    etaSeconds: null,
    phase: "overdue",
    glyph: "WARP",
  },
  {
    id: "rcs",
    label: "Toggle RCS",
    etaSeconds: null,
    phase: "lost",
    glyph: "RCS",
  },
];

/** Commands still on their way up, before anything has come back. */
const OUTBOUND: InFlightListItem[] = [
  {
    id: "gear",
    label: "Deploy landing gear",
    etaSeconds: 18,
    phase: "in-transit",
    progress: 0.1,
  },
  {
    id: "lights",
    label: "Toggle lights",
    etaSeconds: 24,
    phase: "in-transit",
    progress: 0.05,
  },
  {
    id: "chutes",
    label: "Arm parachutes",
    etaSeconds: 61,
    phase: "awaiting-reply",
    progress: 0.4,
  },
];

/** The strip as the Panel's drag bar carries it: a raised band the glows graze from above. */
function DragBar({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        background: "var(--color-surface-raised)",
        border: "1px solid var(--color-border-subtle)",
        borderRadius: "var(--radius-regular)",
        overflow: "hidden",
      }}
    >
      {children}
    </div>
  );
}

const meta = {
  title: "ui-kit/InFlightList",
  component: InFlightList,
  decorators: [
    (Story) => (
      <Column>
        <Story />
      </Column>
    ),
    withGonogoFrame,
  ],
  args: { items: QUEUE, density: "full" },
} satisfies Meta<typeof InFlightList>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Every phase at once: in transit, awaiting reply, due, overdue and lost, each with its arrow, label and countdown. */
export const Phases: Story = {};

/** Compact density drops the labels to the tooltip and keeps the arrow and countdown. */
export const Compact: Story = {
  args: { items: OUTBOUND, density: "compact" },
};

/** Badge density: one chip counting the set, with the nearest arrival. */
export const Badge: Story = {
  args: { items: OUTBOUND, density: "badge" },
};

/** A badge over a set with a failure in it takes the warning phase. */
export const BadgeWithFailure: Story = {
  args: { items: QUEUE, density: "badge" },
};

/** Row orientation flows the entries across and wraps onto further lines. */
export const Row: Story = {
  args: { items: OUTBOUND, density: "compact", orientation: "row" },
};

/** Auto density measures its width: full in a wide column, badge in a narrow one. */
export const AutoDensity: Story = {
  render: (args) => (
    <div style={{ display: "grid", gap: "var(--gap-section)" }}>
      <div style={{ width: 320 }}>
        <InFlightList {...args} density="auto" />
      </div>
      <div style={{ width: 140 }}>
        <InFlightList {...args} density="auto" />
      </div>
      <div style={{ width: 80 }}>
        <InFlightList {...args} density="auto" />
      </div>
    </div>
  ),
  args: { items: OUTBOUND },
};

/** A science transmission coming home: inbound entries in transit point down. */
export const Inbound: Story = {
  args: {
    ariaLabel: "Transmissions home",
    items: [
      {
        id: "crew-report",
        label: "Crew Report from Mun Highlands",
        etaSeconds: 12,
        phase: "in-transit",
        flow: "inbound",
      },
      {
        id: "goo",
        label: "Mystery Goo observation",
        etaSeconds: 33,
        phase: "in-transit",
        flow: "inbound",
      },
      {
        id: "sas",
        label: "SAS Stability Assist",
        etaSeconds: 20,
        phase: "in-transit",
      },
    ],
  },
};

/** The Panel rail strip: each command a glow along the top edge, placed by journey progress, failures in amber and red. */
export const Rail: Story = {
  render: (args) => (
    <DragBar>
      <InFlightList {...args} variant="rail" />
    </DragBar>
  ),
};

function DismissableQueue() {
  const [items, setItems] = useState(QUEUE);
  return (
    <InFlightList
      items={items}
      variant="expanded"
      onDismiss={(id) => setItems((prev) => prev.filter((i) => i.id !== id))}
    />
  );
}

/** The expanded queue: a square per command carrying its glyph; the overdue and lost squares clear when clicked. */
export const Expanded: Story = {
  render: () => <DismissableQueue />,
};
