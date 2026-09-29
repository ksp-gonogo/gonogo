import {
  railTagsForCommand,
  railTagsForControlAxis,
  railTagsForTelemetry,
} from "@ksp-gonogo/sitrep-sdk";
import {
  CommandDelay,
  type CommandDelayHandle,
  type ControlStreamSample,
} from "@ksp-gonogo/ui-kit";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { type ReactNode, useState } from "react";
import { withGonogoFrame } from "../../frame";
import { held } from "../../readings";

function Column({ children }: { children: ReactNode }) {
  return <div style={{ width: 420 }}>{children}</div>;
}

/** One-way light-time to a probe at Duna, long enough that commands queue. */
const ONE_WAY = 40;

/** One-way light-time to a craft in Mun orbit, which a held throttle is flown under. */
const STREAM_ONE_WAY = 1.6;

const SAS_TAGS = railTagsForCommand("vessel.control.setSasMode");
const STAGE_TAGS = railTagsForCommand("vessel.control.stage");
const THROTTLE_TAGS = railTagsForControlAxis("vessel.control.setThrottle");
const VOICE_TAGS = railTagsForTelemetry("continuous");

const SAS: CommandDelayHandle = {
  tags: SAS_TAGS,
  effectiveDelaySeconds: ONE_WAY,
  inFlight: [
    {
      id: "sas-pro",
      label: "SAS Prograde",
      command: "vessel.control.setSasMode",
      reachEtaSeconds: 31,
      replyEtaSeconds: 71,
      predictedPhase: "in-transit",
      glyph: "PRO",
    },
    {
      id: "sas-norm",
      label: "SAS Normal",
      command: "vessel.control.setSasMode",
      reachEtaSeconds: -12,
      replyEtaSeconds: 28,
      predictedPhase: "awaiting-reply",
      glyph: "NRM",
    },
  ],
};

const STAGE: CommandDelayHandle = {
  tags: STAGE_TAGS,
  effectiveDelaySeconds: ONE_WAY,
  inFlight: [
    {
      id: "stage-3",
      label: "Activate stage 3",
      command: "vessel.control.stage",
      reachEtaSeconds: 8,
      replyEtaSeconds: 48,
      predictedPhase: "in-transit",
      glyph: "STG",
    },
    {
      id: "stage-2",
      label: "Activate stage 2",
      command: "vessel.control.stage",
      reachEtaSeconds: null,
      replyEtaSeconds: null,
      predictedPhase: "overdue",
      glyph: "STG",
    },
  ],
};

function history(at: (age: number) => number, from = 0): ControlStreamSample[] {
  const samples: ControlStreamSample[] = [];
  for (let age = from; age <= 3 * STREAM_ONE_WAY + 1e-9; age += 0.1) {
    samples.push({ age, value: at(age) });
  }
  return samples;
}

const throttleAt = (age: number) =>
  0.4 + 0.35 / (1 + Math.exp((age - 2.5) * 4));

const THROTTLE: CommandDelayHandle = {
  tags: THROTTLE_TAGS,
  effectiveDelaySeconds: STREAM_ONE_WAY,
  inFlight: [],
  streams: [
    {
      id: "throttle",
      label: "Throttle",
      oneWaySeconds: STREAM_ONE_WAY,
      inTransit: history(throttleAt),
      echo: history(throttleAt, 2 * STREAM_ONE_WAY),
      current: throttleAt(0),
      tags: THROTTLE_TAGS,
    },
  ],
};

const VOICE: CommandDelayHandle = {
  tags: VOICE_TAGS,
  effectiveDelaySeconds: STREAM_ONE_WAY,
  inFlight: [],
  ariaLabel: "Your transmission crossing to Mun Lander II",
  ribbons: [
    {
      id: "voice",
      label: "Your transmission crossing to Mun Lander II",
      oneWaySeconds: STREAM_ONE_WAY,
      amplitudes: Array.from(
        { length: 48 },
        (_, i) => 0.25 + 0.6 * Math.abs(Math.sin(i * 0.7) * Math.cos(i * 0.23)),
      ),
      tags: VOICE_TAGS,
    },
  ],
};

/** The strip as the Panel's drag bar carries it: a raised band the glows graze from above. */
function DragBar({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        background: "var(--color-surface-raised)",
        border: "1px solid var(--color-border-subtle)",
        borderRadius: "var(--radius-regular)",
        overflow: "hidden",
      }}
    >
      {children}
    </div>
  );
}

const meta = {
  title: "ui-kit/CommandDelay",
  component: CommandDelay,
  decorators: [
    (Story) => (
      <Column>
        <Story />
      </Column>
    ),
    withGonogoFrame,
  ],
  args: { handle: SAS, density: "full" },
} satisfies Meta<typeof CommandDelay>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A delayed discrete command: its in-flight rows, one on the way up and one awaiting its reply. */
export const Discrete: Story = {};

/** Two handles from one widget merged into a single list, including an overdue stage. */
export const MergedHandles: Story = {
  args: { handle: undefined, handles: [SAS, STAGE] },
};

/** A held control axis draws the continuous stream graph instead of rows. */
export const Stream: Story = {
  args: {
    handle: THROTTLE,
    ariaLabel: "Throttle in flight",
    variant: "expanded",
  },
};

/** The same stream inline in a widget body: the short strip with hover labels. */
export const StreamInline: Story = {
  args: { handle: THROTTLE, ariaLabel: "Throttle in flight" },
};

/** The stream graph with its delay figures held, because the delay reading went quiet. */
export const StreamHeldDelay: Story = {
  args: {
    handle: { ...THROTTLE, delayReading: held("s", STREAM_ONE_WAY) },
    variant: "expanded",
  },
};

/** An open microphone draws its voice ribbon on the same graph. */
export const Voice: Story = {
  args: { handle: VOICE, variant: "expanded" },
};

/** The collapsed Panel rail form of the merged discrete queue. */
export const Rail: Story = {
  render: () => (
    <DragBar>
      <CommandDelay handles={[SAS, STAGE]} variant="rail" />
    </DragBar>
  ),
};

function DismissableQueue() {
  const [stage, setStage] = useState(STAGE);
  const handle: CommandDelayHandle = {
    ...stage,
    dismiss: (id) =>
      setStage((prev) => ({
        ...prev,
        inFlight: prev.inFlight.filter((c) => c.id !== id),
      })),
  };
  return <CommandDelay handles={[SAS, handle]} variant="expanded" />;
}

/** The expanded queue: a square per command; the overdue stage clears when clicked. */
export const Expanded: Story = {
  render: () => <DismissableQueue />,
};
