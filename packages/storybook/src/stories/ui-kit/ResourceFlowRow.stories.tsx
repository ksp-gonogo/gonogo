import { ResourceFlowRow } from "@ksp-gonogo/ui-kit";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { withGonogoFrame } from "../../frame";
import { RUNNING_JOB, transferModel } from "./resourceTransferFixtures";

const meta = {
  title: "ui-kit/ResourceFlowRow",
  component: ResourceFlowRow,
  decorators: [withGonogoFrame],
  args: { job: RUNNING_JOB, transfer: transferModel([RUNNING_JOB]) },
} satisfies Meta<typeof ResourceFlowRow>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A transfer running until the destination is full. */
export const Running: Story = {};

/** The list is the last one received, so the row says it is held. */
export const Held: Story = {
  args: { transfer: { ...transferModel([RUNNING_JOB]), held: true } },
};
