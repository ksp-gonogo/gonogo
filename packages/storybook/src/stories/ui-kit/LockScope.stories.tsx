import { UnlockKind, useCommand } from "@ksp-gonogo/sitrep-sdk";
import {
  LockScope,
  type LockSummary,
  Notice,
  Section,
  SectionTitle,
  Stack,
  Text,
} from "@ksp-gonogo/ui-kit";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactNode } from "react";
import { FixtureStream } from "../../FixtureStream";
import { withGonogoFrame } from "../../frame";

const MISSION_CONTROL = {
  kind: UnlockKind.Facility,
  id: "MissionControl",
  name: "Mission Control",
  tier: 2,
};
const FLIGHT_CONTROL = {
  kind: UnlockKind.Tech,
  id: "flightControl",
  name: "Flight Control",
  scienceCost: 45,
};

const COMMAND = "vessel.maneuver.add";

/** What the host says about the one command the scope's contents use. */
type Verdict = "unlocked" | "building" | "tech";

function gates(verdict: Verdict) {
  const outcome =
    verdict === "unlocked"
      ? { outcome: 0, detail: "" }
      : {
          outcome: 1,
          errorCode: "notUnlocked",
          detail: "",
          missing: [verdict === "building" ? MISSION_CONTROL : FLIGHT_CONTROL],
        };
  return [
    {
      topic: "system.uplink.gates",
      payload: { gates: [{ command: COMMAND, verdict: outcome }] },
    },
  ];
}

/** A control that sends the maneuver command: reading it is what ties the scope to its lock. */
function PlanControls() {
  useCommand(COMMAND);
  return (
    <Stack gap="related-dense">
      <Text>Burn planned for the Mun transfer, 842 m/s prograde</Text>
      <Text level="muted">Edit the node from here once the burn is placed</Text>
    </Stack>
  );
}

/** Two sections of one widget: the first stands alone, the second is the scope under test. */
function Widget({
  verdict,
  fallback,
}: {
  verdict: Verdict;
  fallback?: ReactNode | ((lock: LockSummary) => ReactNode);
}) {
  return (
    <FixtureStream subscribed={["system.uplink.gates"]} emits={gates(verdict)}>
      <Stack gap="related">
        <Section>
          <SectionTitle>ORBIT VIEW</SectionTitle>
          <Text>Apoapsis 82.3 km, periapsis 71.0 km</Text>
        </Section>
        <Section>
          <SectionTitle>MANEUVER</SectionTitle>
          <LockScope fallback={fallback}>
            <PlanControls />
          </LockScope>
        </Section>
      </Stack>
    </FixtureStream>
  );
}

const meta = {
  title: "ui-kit/LockScope",
  component: LockScope,
  decorators: [
    (Story) => (
      <div style={{ width: 420 }}>
        <Story />
      </div>
    ),
    withGonogoFrame,
  ],
} satisfies Meta<typeof LockScope>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The command is unlocked in this save, so the scope draws what is inside it. */
export const Unlocked: Story = {
  render: () => <Widget verdict="unlocked" />,
};

/** The command needs a building level this save has not reached: the scope is replaced by the lock's notice, and the section around it stays. */
export const MissingBuilding: Story = {
  render: () => <Widget verdict="building" />,
};

/** The command needs a technology not yet researched, with its science cost in the notice. */
export const MissingTech: Story = {
  render: () => <Widget verdict="tech" />,
};

/** A `fallback` function takes the lock's summary, so the caller words the replacement in its own place. */
export const CustomFallback: Story = {
  render: () => (
    <Widget
      verdict="tech"
      fallback={(lock) => (
        <Notice tone="info">
          {lock.reason}
          {lock.hint === undefined ? "" : `: ${lock.hint}`}
        </Notice>
      )}
    />
  ),
};

/** `fallback={null}` draws nothing while locked, for a scope that is only an overlay. */
export const HiddenWhileLocked: Story = {
  render: () => <Widget verdict="building" fallback={null} />,
};
