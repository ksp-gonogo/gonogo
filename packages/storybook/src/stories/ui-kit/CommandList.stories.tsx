import {
  CommandErrorCode,
  railTagsForCommand,
  railTagsForControlAxis,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import {
  CommandList,
  type RailFailed,
  type RailFound,
  type RailLoss,
  type RailRefusal,
  type RailUndelivered,
} from "@ksp-gonogo/ui-kit";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { type ReactNode, useState } from "react";
import { withGonogoFrame } from "../../frame";

function Column({ children }: { children: ReactNode }) {
  return <div style={{ width: 420 }}>{children}</div>;
}

const STAGE = railTagsForCommand("vessel.control.stage");
const SAS = railTagsForCommand("vessel.control.setSasMode");
const HIRE = railTagsForCommand("career.crew.hire");
const UPGRADE = railTagsForCommand("career.facility.upgrade");
const AXES = railTagsForControlAxis("vessel.control.setAxes");

const REFUSALS: RailRefusal[] = [
  {
    id: "hire-val",
    errorCode: CommandErrorCode.LimitReached,
    command: "career.crew.hire",
    label: "Hire Valentina Kerman",
    tags: HIRE,
    breach: {
      facility: "AstronautComplex",
      facilityName: "Astronaut Complex",
      facilityLevel: value("ratio", 0.5),
      quantity: "activeCrew",
      limit: 12,
      actual: 12,
      unit: "count",
    },
  },
  {
    id: "upgrade-pad",
    errorCode: CommandErrorCode.InsufficientFunds,
    command: "career.facility.upgrade",
    label: "Upgrade Launch Pad",
    tags: UPGRADE,
    breach: {
      facility: "LaunchPad",
      facilityName: "Launch Pad",
      facilityLevel: value("ratio", 0.5),
      quantity: "funds",
      limit: 189_412,
      actual: 253_000,
      unit: "f",
    },
  },
  {
    id: "stage-landed",
    errorCode: CommandErrorCode.ModeUnavailable,
    command: "vessel.control.stage",
    label: "Stage Kerbal X",
    detail: "Staging is locked while the craft is on the launch clamps",
    tags: STAGE,
  },
];

const LOSSES: RailLoss[] = [
  {
    id: "sas-pro",
    command: "vessel.control.setSasMode",
    args: { mode: "Prograde" },
    label: "SAS Prograde",
    tags: SAS,
  },
  {
    id: "axes",
    command: "vessel.control.setAxes",
    label: "Pitch and yaw",
    tags: AXES,
  },
];

const UNDELIVERED: RailUndelivered[] = [
  {
    id: "burn",
    command: "vessel.control.stage",
    label: "Stage for Mun transfer burn",
    tags: STAGE,
  },
];

const FOUND: RailFound[] = [
  {
    id: "found-ran",
    command: "vessel.control.setSasMode",
    label: "SAS Retrograde",
    outcome: "ran",
    tags: SAS,
  },
  {
    id: "found-refused",
    command: "career.facility.upgrade",
    label: "Upgrade Tracking Station",
    outcome: "refused",
    errorCode: CommandErrorCode.AlreadyAtMaximum,
    breach: {
      facility: "TrackingStation",
      facilityName: "Tracking Station",
      facilityLevel: value("ratio", 1),
      quantity: "tier",
      limit: 3,
      actual: 3,
      unit: "count",
    },
    tags: UPGRADE,
  },
];

const FAILED: RailFailed[] = [
  {
    id: "failed-stage",
    command: "vessel.control.stage",
    label: "Stage Jebediah's lander",
    tags: STAGE,
  },
];

const meta = {
  title: "ui-kit/CommandList",
  component: CommandList,
  decorators: [
    (Story) => (
      <Column>
        <Story />
      </Column>
    ),
    withGonogoFrame,
  ],
  args: { kind: "refused", entries: REFUSALS, onDismiss: () => {} },
} satisfies Meta<typeof CommandList>;

export default meta;
type Story = StoryObj<typeof meta>;

function Dismissable({ initial }: { initial: RailRefusal[] }) {
  const [entries, setEntries] = useState(initial);
  return (
    <CommandList
      kind="refused"
      entries={entries}
      onDismiss={(id) => setEntries((prev) => prev.filter((e) => e.id !== id))}
    />
  );
}

/** Refusals in the game's terms, with the numbers from each breach; the cross clears a box. */
export const Refused: Story = {
  render: () => <Dismissable initial={REFUSALS} />,
};

/** Commands nothing answered: they may have run. A continuous axis is named in words, not a glyph tile. */
export const Lost: Story = {
  args: { kind: "lost", entries: LOSSES },
};

/** A command that never left this machine, so a re-send repeats nothing. */
export const Undelivered: Story = {
  args: { kind: "undelivered", entries: UNDELIVERED },
};

/** Unconfirmed commands that answered after all, drawn in the notice tone. */
export const Found: Story = {
  args: { kind: "found", entries: FOUND },
};

/** A command whose machinery broke, with no verdict from the game. */
export const Failed: Story = {
  args: { kind: "failed", entries: FAILED },
};

/** Without `onDismiss` the boxes carry no clear control. */
export const WithoutDismiss: Story = {
  args: { kind: "refused", entries: REFUSALS, onDismiss: undefined },
};

/** Every kind stacked, the way the delay rail draws them under its queues. */
export const AllKinds: Story = {
  render: () => (
    <div style={{ display: "grid", gap: "var(--gap-related)" }}>
      <CommandList kind="refused" entries={REFUSALS.slice(0, 1)} live={false} />
      <CommandList kind="lost" entries={LOSSES.slice(0, 1)} live={false} />
      <CommandList kind="undelivered" entries={UNDELIVERED} live={false} />
      <CommandList kind="found" entries={FOUND.slice(0, 1)} live={false} />
      <CommandList kind="failed" entries={FAILED} live={false} />
    </div>
  ),
};
