/**
 * Standalone probe for the faces a command input draws: a toggle, an icon
 * button and a blocked button, each at rest and in the phase the scenario names.
 * The driver is `render-command-faces`.
 */
import {
  bindCommand,
  bindValue,
  railTagsForCommand,
  type UseCommandResult,
} from "@ksp-gonogo/sitrep-sdk";
import {
  Button,
  CloseIcon,
  type CommandButtonHandle,
  type CommandReplyLike,
  DelayRailProvider,
  IconButton,
  Text,
  ToggleButton,
} from "@ksp-gonogo/ui-kit";
import { createRoot, type Root } from "react-dom/client";

export type Scenario =
  | "rest"
  | "sent"
  | "refused"
  | "lost"
  | "unavailable"
  | "stream-down"
  | "blocked";

export interface FacesPayload {
  pxW: number;
  pxH: number;
}

const SCENARIOS: readonly Scenario[] = [
  "rest",
  "sent",
  "refused",
  "lost",
  "unavailable",
  "stream-down",
  "blocked",
];

let activeRoot: Root | null = null;

/** The scenarios the driver reaches by pressing the control. */
const isPressed = (scenario: Scenario) =>
  scenario === "sent" || scenario === "refused" || scenario === "lost";

function handleFor(scenario: Scenario): CommandButtonHandle {
  const never = () => new Promise<CommandReplyLike>(() => {});
  const refuse = () =>
    Promise.reject(
      Object.assign(new Error("refused"), {
        code: "E_REFUSED",
        errorCode: "wrongState",
        detail: "the vessel is not controllable",
      }),
    );
  const lose = () =>
    Promise.reject(Object.assign(new Error("lost"), { code: "E_LOST" }));
  const send =
    scenario === "refused" ? refuse : scenario === "lost" ? lose : never;
  const handle: CommandButtonHandle = {
    dangerouslySendWithoutInput: send,
    inFlight: [],
    tags: railTagsForCommand("vessel.control.setRcs"),
    effectiveDelaySeconds: 0,
    streamDown: scenario === "stream-down",
    status:
      scenario === "sent"
        ? { phase: "in-flight", requestId: "r1", etaConfirm: 0 }
        : undefined,
    gate:
      scenario === "blocked"
        ? {
            blocked: true,
            errorCode: "wrongState",
            detail: "the vessel is not controllable",
          }
        : undefined,
    with(args, options) {
      return bindCommand(this, args, options);
    },
    toArgs(toArgs, options) {
      return bindValue(this, toArgs, options);
    },
  };
  return handle;
}

const CELL = {
  display: "grid",
  justifyItems: "center",
  gap: "var(--gap-glyph)",
  padding: "var(--inset-placeholder)",
} as const;

const GRID = {
  display: "grid",
  gridTemplateColumns: `repeat(${SCENARIOS.length}, 1fr)`,
  gap: "var(--gap-glyph)",
} as const;

function Toggle({ scenario, on }: { scenario: Scenario; on: boolean }) {
  const handle = handleFor(scenario) as unknown as UseCommandResult;
  return (
    <ToggleButton
      size="sm"
      data-act={
        scenario === "sent" || scenario === "refused" || scenario === "lost"
          ? ""
          : undefined
      }
      command={handle.toArgs((next: boolean) => ({ enabled: next }), {
        label: "Toggle RCS",
      })}
      state={on}
      name="RCS"
      unavailable={
        scenario === "unavailable" ? "Vessel not controllable" : null
      }
    >
      {(shown) => (shown === true ? "RCS ON" : "RCS OFF")}
    </ToggleButton>
  );
}

function Icon({ scenario, on }: { scenario: Scenario; on: boolean }) {
  const handle = handleFor(scenario) as unknown as UseCommandResult;
  return (
    <IconButton
      aria-label="Toggle lamp"
      data-act={
        scenario === "sent" || scenario === "refused" || scenario === "lost"
          ? ""
          : undefined
      }
      command={handle.toArgs((next: boolean) => ({ enabled: next }), {
        label: "Toggle lamp",
      })}
      state={on}
      name="Lamp"
      unavailable={
        scenario === "unavailable" ? "Lamp state not reported" : null
      }
    >
      <CloseIcon />
    </IconButton>
  );
}

function IconAction({ scenario }: { scenario: Scenario }) {
  const handle = handleFor(scenario) as unknown as UseCommandResult;
  return (
    <IconButton
      aria-label="Close hatch"
      data-act={isPressed(scenario) ? "" : undefined}
      command={handle.with(undefined, { label: "Close hatch" })}
      unavailable={scenario === "unavailable" ? "Hatch is locked" : null}
    >
      <CloseIcon />
    </IconButton>
  );
}

function Plain({ scenario }: { scenario: Scenario }) {
  const handle = handleFor(scenario) as unknown as UseCommandResult;
  return (
    <Button
      size="sm"
      variant="ghost"
      data-act={
        scenario === "sent" || scenario === "refused" || scenario === "lost"
          ? ""
          : undefined
      }
      command={handle.with(undefined, { label: "Launch Kerbal I" })}
      unavailable={scenario === "unavailable" ? "No vessel on the pad" : null}
    >
      Launch
    </Button>
  );
}

function LongLabel({ scenario }: { scenario: Scenario }) {
  const handle = handleFor(scenario) as unknown as UseCommandResult;
  return (
    <Button
      size="sm"
      variant="ghost"
      data-act={isPressed(scenario) ? "" : undefined}
      command={handle.with(undefined, { label: "Fly Kerbal X" })}
      unavailable={scenario === "unavailable" ? "No vessel on the pad" : null}
    >
      Fly Kerbal X
    </Button>
  );
}

function Harness() {
  const rows: [string, (s: Scenario) => React.ReactNode][] = [
    ["Toggle off", (s) => <Toggle scenario={s} on={false} />],
    ["Toggle on", (s) => <Toggle scenario={s} on={true} />],
    ["Icon toggle off", (s) => <Icon scenario={s} on={false} />],
    ["Icon toggle on", (s) => <Icon scenario={s} on={true} />],
    ["Icon button", (s) => <IconAction scenario={s} />],
    ["Button", (s) => <Plain scenario={s} />],
    ["Long label", (s) => <LongLabel scenario={s} />],
  ];
  return (
    <DelayRailProvider>
      <div
        style={{
          padding: "var(--inset-placeholder)",
          display: "grid",
          gap: "var(--gap-glyph)",
        }}
      >
        <div style={GRID}>
          {SCENARIOS.map((s) => (
            <Text
              key={s}
              level="muted"
              size="xs"
              style={{ textAlign: "center" }}
            >
              {s}
            </Text>
          ))}
        </div>
        {rows.map(([name, draw]) => (
          <div key={name} data-row={name}>
            <Text level="muted" size="xs">
              {name}
            </Text>
            <div style={GRID}>
              {SCENARIOS.map((s) => (
                <div key={s} style={CELL} data-scenario={s}>
                  {draw(s)}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </DelayRailProvider>
  );
}

async function renderFaces(payload: FacesPayload): Promise<void> {
  const root = document.getElementById("root");
  if (!root) throw new Error("Command faces probe: #root missing");
  activeRoot?.unmount();
  root.style.width = `${payload.pxW}px`;
  root.style.background = "var(--color-surface-panel)";
  root.innerHTML = "";
  activeRoot = createRoot(root);
  activeRoot.render(<Harness />);
  await new Promise<void>((r) => requestAnimationFrame(() => r()));
  await new Promise<void>((r) => requestAnimationFrame(() => r()));
  await new Promise<void>((r) => setTimeout(r, 300));
}

declare global {
  interface Window {
    __renderCommandFaces: typeof renderFaces;
  }
}

window.__renderCommandFaces = renderFaces;
