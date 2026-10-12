import type { Meta, StoryObj } from "@storybook/react-vite";
import { AlarmsThresholdScene } from "../../alarmScenes";
import { withGonogoFrame } from "../../frame";

/** The alarms dialog with its threshold form open and two conditional alarms listed. */
const meta = {
  title: "App/Alarms",
  decorators: [withGonogoFrame],
  parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;

export const ThresholdObservedOnly: StoryObj<typeof AlarmsThresholdScene> = {
  name: "Threshold form: observed values",
  render: () => <AlarmsThresholdScene reckoned={false} />,
};

export const ThresholdWithReckoned: StoryObj<typeof AlarmsThresholdScene> = {
  name: "Threshold form: reckoned values included",
  render: () => <AlarmsThresholdScene reckoned />,
};
