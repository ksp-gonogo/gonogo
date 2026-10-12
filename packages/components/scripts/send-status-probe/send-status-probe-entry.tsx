/**
 * Standalone probe for the send status a command control shows. Mounts
 * `CommandButton`s with hand-built handles whose `sendStatus` is the one the
 * scenario names. The driver is `render-send-status`.
 */
import {
  railTagsForCommand,
  type SendStatus,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import {
  Button,
  CommandButton,
  DataLine,
  DelayRailProvider,
  Panel,
} from "@ksp-gonogo/ui-kit";
import { createRoot, type Root } from "react-dom/client";

export type SendStatusState = "before" | "now" | "held" | "loss" | "none";

const STATUSES: Record<Exclude<SendStatusState, "before">, SendStatus> = {
  now: {
    contact: { kind: "in-contact" },
    signalDelay: value("s", 480),
    arrival: "expected",
    sends: "now",
    arrivesUt: value("ut", 5_000_480),
  },
  held: {
    contact: { kind: "back-in", seconds: value("s", 180) },
    signalDelay: value("s", 1_200),
    arrival: "expected",
    sends: "held",
    heldUntilUt: value("ut", 5_000_180),
    arrivesUt: value("ut", 5_001_200),
  },
  loss: {
    contact: { kind: "loss-in", seconds: value("s", 300) },
    signalDelay: value("s", 480),
    arrival: "likely-lost",
    sends: "now",
    arrivesUt: value("ut", 5_000_480),
  },
  none: { contact: { kind: "none" }, arrival: "likely-lost" },
};

export interface SendStatusPayload {
  /** `states` is one labelled button per state; `single` is one `Fire` between two plain neighbours; `widget` is the row inside a panel among readouts. */
  layout: "states" | "single" | "widget";
  state?: SendStatusState;
  pxW: number;
  pxH: number;
}

let activeRoot: Root | null = null;

function handleFor(state: SendStatusState) {
  return {
    send: () => new Promise<{ success: true }>(() => {}),
    inFlight: [],
    tags: railTagsForCommand("vessel.control.setSasMode"),
    effectiveDelaySeconds: 480,
    sendStatus: state === "before" ? undefined : STATUSES[state],
  };
}

const ROW = {
  display: "flex",
  alignItems: "center",
  gap: "var(--gap-glyph)",
  padding: "var(--inset-placeholder)",
} as const;

const LABELS: Record<Exclude<SendStatusState, "before">, string> = {
  now: "Sends now",
  held: "Held",
  loss: "LOS",
  none: "No route",
};

function Harness({ payload }: { payload: SendStatusPayload }) {
  if (payload.layout === "single") {
    return (
      <DelayRailProvider>
        <div style={ROW}>
          <Button data-neighbour="a">Left</Button>
          <CommandButton
            handle={handleFor(payload.state ?? "before")}
            label="Fire"
          />
          <Button data-neighbour="b">Right</Button>
        </div>
      </DelayRailProvider>
    );
  }
  const row = (
    <div style={ROW}>
      {(Object.keys(LABELS) as (keyof typeof LABELS)[]).map((state) => (
        <CommandButton
          key={state}
          handle={handleFor(state)}
          label={LABELS[state]}
        />
      ))}
    </div>
  );
  if (payload.layout === "states") {
    return <DelayRailProvider>{row}</DelayRailProvider>;
  }
  return (
    <DelayRailProvider>
      <Panel panelTitle="Engine">
        <div style={{ padding: "var(--inset-placeholder)" }}>
          <DataLine label="Throttle">72%</DataLine>
          <DataLine label="Thrust">168 kN</DataLine>
        </div>
        {row}
        <div style={{ padding: "var(--inset-placeholder)" }}>
          <DataLine label="Fuel">41%</DataLine>
        </div>
      </Panel>
    </DelayRailProvider>
  );
}

async function renderSendStatus(payload: SendStatusPayload): Promise<void> {
  const root = document.getElementById("root");
  if (!root) throw new Error("Send status probe: #root missing");
  activeRoot?.unmount();
  root.style.width = `${payload.pxW}px`;
  root.style.height = `${payload.pxH}px`;
  root.style.background = "var(--color-surface-panel)";
  root.innerHTML = "";
  activeRoot = createRoot(root);
  activeRoot.render(<Harness payload={payload} />);
  await new Promise<void>((r) => requestAnimationFrame(() => r()));
  await new Promise<void>((r) => requestAnimationFrame(() => r()));
  await new Promise<void>((r) => setTimeout(r, 300));
}

declare global {
  interface Window {
    __renderSendStatus: typeof renderSendStatus;
  }
}

window.__renderSendStatus = renderSendStatus;
