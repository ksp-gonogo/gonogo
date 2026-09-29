import type { StreamStatusValue } from "@ksp-gonogo/sitrep-sdk";
import { Cluster, StreamStatusBadge, Text } from "@ksp-gonogo/ui-kit";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { withGonogoFrame } from "../../frame";

const meta = {
  title: "ui-kit/StreamStatusBadge",
  component: StreamStatusBadge,
  decorators: [
    (Story) => (
      <div style={{ width: 480 }}>
        <Story />
      </div>
    ),
    withGonogoFrame,
  ],
  args: { status: "held-stale" },
} satisfies Meta<typeof StreamStatusBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

const DEGRADED: StreamStatusValue[] = [
  "held-stale",
  "last-before-blackout",
  "recorded",
  "disconnected",
  "resyncing",
  "absent",
];

/** Every degraded status, each with its own caption and severity. */
export const Statuses: Story = {
  render: () => (
    <Cluster>
      {DEGRADED.map((status) => (
        <StreamStatusBadge key={status} status={status} />
      ))}
    </Cluster>
  ),
};

/** Beside a sub-region title reading a topic other than the panel's own. */
export const BesideATitle: Story = {
  render: (args) => (
    <Cluster>
      <Text>Relay antenna</Text>
      <StreamStatusBadge {...args} />
    </Cluster>
  ),
};

/** A live stream draws no badge: only the title stands. */
export const Live: Story = {
  render: () => (
    <Cluster>
      <Text>Relay antenna</Text>
      <StreamStatusBadge status="live" />
    </Cluster>
  ),
};
