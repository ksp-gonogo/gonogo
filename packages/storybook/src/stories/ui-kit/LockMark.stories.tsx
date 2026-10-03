import { UnlockKind } from "@ksp-gonogo/sitrep-sdk";
import { LockMark, type LockSummary } from "@ksp-gonogo/ui-kit";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { withGonogoFrame } from "../../frame";

const techLock: LockSummary = {
  reason: "Missing tech: Flight Control",
  hint: "45.0sci to research",
  locks: [
    {
      capability: { kind: "topic", id: "kos.processors" },
      missing: [
        {
          kind: UnlockKind.Tech,
          id: "flightControl",
          name: "Flight Control",
        },
      ],
    },
  ],
};

const buildingLock: LockSummary = {
  reason: "Tracking Station",
  hint: "Needs Building level 2",
  locks: [
    {
      capability: { kind: "command", id: "vessel.maneuver.add" },
      missing: [
        {
          kind: UnlockKind.Facility,
          id: "TrackingStation",
          name: "Tracking Station",
        },
      ],
    },
  ],
};

const meta = {
  title: "ui-kit/LockMark",
  component: LockMark,
  decorators: [withGonogoFrame],
  args: { lock: techLock },
} satisfies Meta<typeof LockMark>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A part this save has not researched: the padlock and the node's name, the whole sentence on hover. */
export const MissingTech: Story = {};

/** A building below the level a capability needs. */
export const MissingBuilding: Story = { args: { lock: buildingLock } };
