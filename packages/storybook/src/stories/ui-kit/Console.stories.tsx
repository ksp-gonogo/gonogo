import {
  ComposerBar,
  Console,
  type InFlightListItem,
} from "@ksp-gonogo/ui-kit";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { type ReactNode, useState } from "react";
import { withGonogoFrame } from "../../frame";
import { held } from "../../readings";

function Tile({ children }: { children: ReactNode }) {
  return (
    <div style={{ width: 460, height: 320, display: "flex" }}>{children}</div>
  );
}

const SCROLLBACK = [
  "Script Terminal v1.4",
  "KerboScript v1.4.0.0",
  "Proceed.",
  "> run launch.ks.",
  "Countdown: 3 2 1",
  "Liftoff! Holding pitch 90 until 1 km.",
  "Gravity turn: pitch 75 at 8 km.",
  "Apoapsis 80.2 km reached, engines cut.",
];

function Scrollback({ lines }: { lines: readonly string[] }) {
  return (
    <pre
      style={{
        margin: 0,
        padding: "var(--inset-panel-body)",
        fontFamily: "var(--font-family-mono)",
        fontSize: "var(--font-size-compact)",
        color: "var(--color-text-primary)",
        overflow: "auto",
        flex: 1,
      }}
    >
      {lines.join("\n")}
    </pre>
  );
}

/** A working line composer: Enter or the send button echoes the line into the scrollback. */
function LiveConsole({
  blocked = false,
  ...props
}: Omit<Parameters<typeof Console>[0], "composer"> & { blocked?: boolean }) {
  const [lines, setLines] = useState(SCROLLBACK);
  const [draft, setDraft] = useState("");
  const send = () => {
    if (blocked || draft.trim() === "") return;
    setLines((prev) => [...prev, `> ${draft}`]);
    setDraft("");
  };
  return (
    <Console
      {...props}
      composer={
        <ComposerBar
          prompt=">"
          blocked={blocked}
          {...(blocked ? { flag: "NO PATH" } : {})}
          onSend={send}
          sendDisabled={blocked || draft.trim() === ""}
        >
          <input
            aria-label="Script command"
            placeholder="print ship:altitude."
            value={draft}
            disabled={blocked}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") send();
            }}
            style={{
              flex: 1,
              minWidth: 0,
              border: "none",
              background: "transparent",
              color: "var(--color-text-primary)",
              fontFamily: "var(--font-family-mono)",
              fontSize: "var(--font-size-compact)",
            }}
          />
        </ComposerBar>
      }
    >
      <Scrollback lines={lines} />
    </Console>
  );
}

const IN_FLIGHT: InFlightListItem[] = [
  {
    id: "1",
    label: "run circularise.ks",
    etaSeconds: 142,
    phase: "in-transit",
    progress: 0.2,
  },
  {
    id: "2",
    label: "lock steering to prograde",
    etaSeconds: 38,
    phase: "in-transit",
    progress: 0.55,
  },
  {
    id: "3",
    label: "stage.",
    etaSeconds: null,
    phase: "awaiting-reply",
    progress: 0.8,
  },
];

const meta = {
  title: "ui-kit/Console",
  component: Console,
  decorators: [
    (Story) => (
      <Tile>
        <Story />
      </Tile>
    ),
    withGonogoFrame,
  ],
} satisfies Meta<typeof Console>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A scripting terminal in low Kerbin orbit: scrollback, a composer that sends, and a standing chip for the sub-second delay. */
export const NearbyCraft: Story = {
  render: () => <LiveConsole oneWaySeconds={0.4} />,
};

/** Minutes of light-lag to a Duna probe: what is still crossing queues between the scrollback and the composer, and no chip. */
export const LongDelayQueue: Story = {
  render: () => <LiveConsole oneWaySeconds={240} inFlight={IN_FLIGHT} />,
};

/** A read-only viewer at the same distance: it can queue nothing, so neither reading draws. */
export const ReadOnlyViewer: Story = {
  render: () => (
    <Console tone="info" oneWaySeconds={240} canQueue={false}>
      <Scrollback lines={SCROLLBACK} />
    </Console>
  ),
};

/** Character mode: the composer is given but absent, so the foot keeps its height and the chip is forced. */
export const CharacterMode: Story = {
  render: () => (
    <Console oneWaySeconds={240} alwaysBadge composer={false}>
      <Scrollback lines={SCROLLBACK} />
    </Console>
  ),
};

/** The delay reading went quiet: the chip's figure draws held. */
export const HeldDelay: Story = {
  render: () => (
    <LiveConsole oneWaySeconds={0.4} delayReading={held("s", 0.4)} />
  ),
};

/** No path home: no chip and no queue, and the composer outlines itself in the error tone with a flag saying why. */
export const NoPath: Story = {
  render: () => <LiveConsole oneWaySeconds={null} blocked />,
};

/** An inbox with nothing to type at: no composer grows no foot. */
export const ScrollbackOnly: Story = {
  render: () => (
    <Console tone="info">
      <Scrollback
        lines={[
          "KSC: Kerbal X, you are GO for orbit.",
          "Kerbal X: Copy, circularising at apoapsis.",
          "KSC: Jeb, stop waving at the camera.",
        ]}
      />
    </Console>
  ),
};
