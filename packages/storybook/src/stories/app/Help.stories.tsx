import type { Meta, StoryObj } from "@storybook/react-vite";
import { withGonogoFrame } from "../../frame";
import {
  AppVersionScene,
  EmptyDashboardScene,
  FirstLoadChoicesScene,
} from "../../helpScenes";

/** The first-load page, the version row under Settings, General, About, and the empty dashboard. */
const meta = {
  title: "App/First load and version",
  decorators: [withGonogoFrame],
  parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;

export const ChoicesUnanswered: StoryObj<typeof FirstLoadChoicesScene> = {
  name: "First load: unanswered",
  render: () => <FirstLoadChoicesScene state="unanswered" />,
};

export const ChoicesPartly: StoryObj<typeof FirstLoadChoicesScene> = {
  name: "First load: partly answered",
  render: () => <FirstLoadChoicesScene state="partly" />,
};

export const ChoicesAnswered: StoryObj<typeof FirstLoadChoicesScene> = {
  name: "First load: answered",
  render: () => <FirstLoadChoicesScene state="answered" />,
};

export const ChoicesStation: StoryObj<typeof FirstLoadChoicesScene> = {
  name: "First load: station",
  render: () => <FirstLoadChoicesScene state="station" />,
};

export const VersionUpdate: StoryObj<typeof AppVersionScene> = {
  name: "Version: newer release",
  render: () => <AppVersionScene world="update" />,
};

export const VersionCurrent: StoryObj<typeof AppVersionScene> = {
  name: "Version: current",
  render: () => <AppVersionScene world="current" />,
};

export const VersionOffline: StoryObj<typeof AppVersionScene> = {
  name: "Version: could not check",
  render: () => <AppVersionScene world="offline" />,
};

export const VersionMismatch: StoryObj<typeof AppVersionScene> = {
  name: "Version: mod from another release",
  render: () => <AppVersionScene world="mismatch" />,
};

export const EmptyDashboard: StoryObj<typeof EmptyDashboardScene> = {
  name: "Empty dashboard",
  render: () => <EmptyDashboardScene />,
};
