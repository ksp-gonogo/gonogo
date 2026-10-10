import type { Meta, StoryObj } from "@storybook/react-vite";
import { FirstRunScene } from "../../firstRunScenes";
import { withGonogoFrame } from "../../frame";

/**
 * Every step of the first-run setup, with nothing running and with everything
 * answering, plus the states in between that carry words of their own. The
 * review sheet links each line of the wizard's copy to the first story here
 * that shows it.
 */
const meta = {
  title: "App/First-run setup",
  component: FirstRunScene,
  decorators: [withGonogoFrame],
  parameters: { layout: "fullscreen" },
  argTypes: {
    step: { control: false },
    world: { control: false },
  },
} satisfies Meta<typeof FirstRunScene>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WelcomeNothingRunning: Story = {
  name: "Welcome: nothing running",
  args: { step: "welcome", world: "nothing-running" },
};

export const WelcomeAllAnswering: Story = {
  name: "Welcome: all answering",
  args: { step: "welcome", world: "all-answering" },
};

export const ContainerNothingRunning: Story = {
  name: "Container: nothing running",
  args: { step: "container", world: "nothing-running" },
};

export const ContainerAllAnswering: Story = {
  name: "Container: all answering",
  args: { step: "container", world: "all-answering" },
};

export const ConnectNothingRunning: Story = {
  name: "Connect: nothing running",
  args: { step: "connect", world: "nothing-running" },
};

export const ConnectAllAnswering: Story = {
  name: "Connect: all answering",
  args: { step: "connect", world: "all-answering" },
};

export const UplinksNothingRunning: Story = {
  name: "Uplinks: nothing running",
  args: { step: "uplinks", world: "nothing-running" },
};

export const UplinksAllAnswering: Story = {
  name: "Uplinks: all answering",
  args: { step: "uplinks", world: "all-answering" },
};

export const HealthNothingRunning: Story = {
  name: "Health: nothing running",
  args: { step: "health", world: "nothing-running" },
};

export const HealthAllAnswering: Story = {
  name: "Health: all answering",
  args: { step: "health", world: "all-answering" },
};

export const DoneNothingRunning: Story = {
  name: "Done: nothing running",
  args: { step: "done", world: "nothing-running" },
};

export const DoneAllAnswering: Story = {
  name: "Done: all answering",
  args: { step: "done", world: "all-answering" },
};

export const ContainerChecking: Story = {
  name: "Container: checking",
  args: { step: "container", world: "checking" },
};

export const ConnectChecking: Story = {
  name: "Connect: checking",
  args: { step: "connect", world: "checking" },
};

export const HealthChecking: Story = {
  name: "Health: checking",
  args: { step: "health", world: "checking" },
};

export const UplinksNoneInstalled: Story = {
  name: "Uplinks: none installed",
  args: { step: "uplinks", world: "no-uplinks" },
};

export const UplinksNeedsAttention: Story = {
  name: "Uplinks: needs attention",
  args: { step: "uplinks", world: "needs-attention" },
};

export const HealthNeedsAttention: Story = {
  name: "Health: needs attention",
  args: { step: "health", world: "needs-attention" },
};
