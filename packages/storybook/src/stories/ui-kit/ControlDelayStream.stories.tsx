import {
  railTagsForControlAxis,
  railTagsForTelemetry,
} from "@ksp-gonogo/sitrep-sdk";
import {
  ControlDelayStream,
  type ControlRibbonDatum,
  type ControlStreamDatum,
  type ControlStreamSample,
} from "@ksp-gonogo/ui-kit";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactNode } from "react";
import { withGonogoFrame } from "../../frame";
import { held } from "../../readings";

function Column({ children }: { children: ReactNode }) {
  return <div style={{ width: 480 }}>{children}</div>;
}

/** One-way light-time to a craft in low Mun orbit, as the strip's T. */
const ONE_WAY = 1.6;

const THROTTLE_TAGS = railTagsForControlAxis("vessel.control.setThrottle");
const AXES_TAGS = railTagsForControlAxis("vessel.control.setAxes");
const VOICE_TAGS = railTagsForTelemetry("continuous");

/** A commanded history sampled every tenth of a second across the whole 3T strip. */
function history(
  at: (age: number) => number,
  from = 0,
  to = 3 * ONE_WAY,
): ControlStreamSample[] {
  const samples: ControlStreamSample[] = [];
  for (let age = from; age <= to + 1e-9; age += 0.1) {
    samples.push({ age, value: Math.max(0, Math.min(1, at(age))) });
  }
  return samples;
}

/** The throttle was eased up from 40% to 75% about 2.5 s ago. */
const throttleAt = (age: number) =>
  0.4 + 0.35 / (1 + Math.exp((age - 2.5) * 4));

/** Pitch nudged down and back, centred on 0.5. */
const pitchAt = (age: number) => 0.5 - 0.2 * Math.exp(-((age - 1.2) ** 2) * 3);

/** Yaw drifting slightly right of centre. */
const yawAt = (age: number) => 0.5 + 0.08 * Math.sin(age * 1.7);

function axis(
  id: string,
  label: string,
  at: (age: number) => number,
  tags = AXES_TAGS,
  echoAt: (age: number) => number = at,
): ControlStreamDatum {
  return {
    id,
    label,
    oneWaySeconds: ONE_WAY,
    inTransit: history(at),
    echo: history(echoAt, 2 * ONE_WAY),
    current: at(0),
    tags,
  };
}

const THROTTLE = axis("throttle", "Throttle", throttleAt, THROTTLE_TAGS);
const PITCH = axis("pitch", "Pitch", pitchAt);
const YAW = axis("yaw", "Yaw", yawAt);

/** The craft echoes a throttle below what was commanded: the engine is flamed out. */
const FLAMED_OUT = axis(
  "throttle",
  "Throttle",
  throttleAt,
  THROTTLE_TAGS,
  (age) => (age < 3.6 ? throttleAt(age) : 0.1),
);

/** Loudness of a flight director's call to Jebediah Kerman, newest sample last. */
const VOICE: ControlRibbonDatum = {
  id: "voice",
  label: "Your transmission crossing to Mun Lander II",
  oneWaySeconds: ONE_WAY,
  amplitudes: Array.from(
    { length: 48 },
    (_, i) => 0.25 + 0.6 * Math.abs(Math.sin(i * 0.7) * Math.cos(i * 0.23)),
  ),
  tags: VOICE_TAGS,
};

const meta = {
  title: "ui-kit/ControlDelayStream",
  component: ControlDelayStream,
  decorators: [
    (Story) => (
      <Column>
        <Story />
      </Column>
    ),
    withGonogoFrame,
  ],
  args: { streams: [THROTTLE, PITCH, YAW], ariaLabel: "Controls in flight" },
} satisfies Meta<typeof ControlDelayStream>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The expanded graph: throttle, pitch and yaw crossing to the craft, with zone labels, legend and readout. */
export const Expanded: Story = {
  args: { variant: "expanded" },
};

/** The in-widget strip: each axis's commanded path, and its confirmed echo past the 2T divider. */
export const Inline: Story = {};

/** The collapsed 16px rail strip, no labels. */
export const Rail: Story = {
  args: { variant: "rail" },
};

/** A single throttle axis, the common case for an engine control. */
export const SingleAxis: Story = {
  args: { streams: [THROTTLE], variant: "expanded" },
};

/** The echo diverges from the commanded throttle: the warning line and the dashed expected path. */
export const Deviation: Story = {
  args: { streams: [FLAMED_OUT], variant: "expanded" },
};

/** The link delay stopped updating: the T and 2T figures are marked held. */
export const HeldDelay: Story = {
  args: { variant: "expanded", delayReading: held("s", ONE_WAY) },
};

/** An open microphone: a voice ribbon in the outgoing zone, ending at the T divider. */
export const VoiceRibbon: Story = {
  args: {
    streams: [],
    ribbons: [VOICE],
    variant: "expanded",
    ariaLabel: VOICE.label,
  },
};

/** Control axes and an open microphone on the one graph. */
export const AxesAndVoice: Story = {
  args: { streams: [THROTTLE, PITCH], ribbons: [VOICE], variant: "expanded" },
};
