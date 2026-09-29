import type { Meta, StoryObj } from "@storybook/react-vite";
import { withGonogoFrame } from "../../frame";
import {
  GoNoGoMainScene,
  type SceneStation,
  THIS_VERSION,
} from "../../goNoGoScenes";

const FLIGHT: SceneStation = {
  peerId: "station-flight",
  name: "Flight",
  vote: "go",
  version: THIS_VERSION,
};
const BOOSTER: SceneStation = {
  peerId: "station-booster",
  name: "Booster",
  vote: "go",
  version: THIS_VERSION,
};
const GUIDANCE: SceneStation = {
  peerId: "station-guidance",
  name: "Guidance",
  vote: "go",
  version: THIS_VERSION,
};
const EECOM: SceneStation = {
  peerId: "station-eecom",
  name: "EECOM",
  vote: "go",
  version: THIS_VERSION,
};

const meta = {
  title: "Widgets/gonogo",
  component: GoNoGoMainScene,
  decorators: [withGonogoFrame],
  parameters: { layout: "fullscreen" },
  argTypes: {
    stations: { control: false },
    w: { control: { type: "range", min: 3, max: 36, step: 1 } },
    h: { control: { type: "range", min: 3, max: 40, step: 1 } },
  },
} satisfies Meta<typeof GoNoGoMainScene>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * The main screen polling four stations before launch: two GO, one holding
 * NO-GO, and one whose tile is not mounted so it casts no vote. Guidance runs
 * an older build and its tile says so.
 */
export const PollInProgress: Story = {
  name: "Main, poll in progress",
  args: {
    stations: [
      FLIGHT,
      { ...BOOSTER, vote: "no-go" },
      { ...GUIDANCE, version: "0.1.0" },
      { ...EECOM, vote: null },
    ],
    w: 8,
    h: 8,
  },
};

/** Every station GO, so the host is counting down to the auto-stage at T-0. */
export const CountingDown: Story = {
  name: "Main, all GO and counting down",
  args: {
    stations: [FLIGHT, BOOSTER, GUIDANCE, EECOM],
    w: 8,
    h: 8,
  },
};

/** After liftoff every station has left the poll, and one has pressed ABORT. */
export const Aborted: Story = {
  name: "Main, launched and aborted",
  args: {
    stations: [
      { ...FLIGHT, vote: null },
      { ...BOOSTER, vote: null },
      { ...GUIDANCE, vote: null },
      { ...EECOM, vote: null },
    ],
    launched: true,
    abortBy: BOOSTER.peerId,
    w: 8,
    h: 8,
  },
};

/** After liftoff with nothing wrong: the board reads mission active. */
export const MissionActive: Story = {
  name: "Main, launched",
  args: {
    stations: [
      { ...FLIGHT, vote: null },
      { ...BOOSTER, vote: null },
      { ...GUIDANCE, vote: null },
    ],
    launched: true,
    w: 8,
    h: 8,
  },
};

/** The host is up and no station has joined yet. */
export const NoStations: Story = {
  name: "Main, no stations",
  args: { stations: [], w: 6, h: 4 },
};

/*
 * The station-side scene is not covered here: see the note above
 * `GoNoGoStationScene` in `../../goNoGoScenes` for why.
 */
