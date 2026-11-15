/**
 * Standalone probe for the faces the non-button command inputs draw: a switch,
 * a select, a text field, a slider, a stepper, a row and a menu item, each at
 * rest and in the state the scenario names. The driver is `render-command-inputs`.
 */
import {
  bindCommand,
  bindValue,
  railTagsForCommand,
  type SendStatus,
  type UseCommandResult,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import {
  ActionMenu,
  type CommandButtonHandle,
  type CommandReplyLike,
  DelayRailProvider,
  Row,
  RowName,
  Select,
  Slider,
  Stepper,
  Switch,
  Text,
  TextField,
} from "@ksp-gonogo/ui-kit";
import { createRoot, type Root } from "react-dom/client";

export type Scenario =
  | "rest"
  | "sent"
  | "refused"
  | "lost"
  | "warning"
  | "blocked"
  | "unavailable"
  | "stream-down";

export interface InputsPayload {
  pxW: number;
  pxH: number;
}

const SCENARIOS: readonly Scenario[] = [
  "rest",
  "sent",
  "refused",
  "lost",
  "warning",
  "blocked",
  "unavailable",
  "stream-down",
];

let activeRoot: Root | null = null;

const needsPress = (s: Scenario) =>
  s === "sent" || s === "refused" || s === "lost";

/** A command the mod is predicted to lose on the way: the warning that does not block the press. */
const AT_RISK: SendStatus = {
  contact: { kind: "loss-in", seconds: value("s", 90) },
  signalDelay: value("s", 12),
  arrival: "likely-lost",
  sends: "now",
};

function handleFor(scenario: Scenario): UseCommandResult {
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
  const handle = {
    dangerouslySendWithoutInput:
      scenario === "refused" ? refuse : scenario === "lost" ? lose : never,
    inFlight: [],
    tags: railTagsForCommand("vessel.control.setRcs"),
    effectiveDelaySeconds: 0,
    streamDown: scenario === "stream-down",
    sendStatus: scenario === "warning" ? AT_RISK : undefined,
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
    with(args: unknown, options: unknown) {
      return bindCommand(this as never, args as never, options as never);
    },
    toArgs(toArgs: never, options: unknown) {
      return bindValue(this as never, toArgs, options as never);
    },
  } as unknown as CommandButtonHandle;
  return handle as unknown as UseCommandResult;
}

const unavailable = (s: Scenario, why: string) =>
  s === "unavailable" ? why : null;

const CELL = {
  display: "grid",
  justifyItems: "start",
  alignContent: "center",
  gap: "var(--gap-glyph)",
  padding: "var(--inset-placeholder)",
  minHeight: "52px",
  minWidth: 0,
} as const;

const GRID = {
  display: "grid",
  gridTemplateColumns: `repeat(${SCENARIOS.length}, minmax(0, 1fr))`,
  gap: "var(--gap-glyph)",
} as const;

function Act({ s, children }: { s: Scenario; children: React.ReactNode }) {
  return (
    <div data-scenario-cell={needsPress(s) ? "" : undefined}>{children}</div>
  );
}

function SwitchCell({ s }: { s: Scenario }) {
  const h = handleFor(s);
  return (
    <Act s={s}>
      <Switch
        aria-label="Auto-retarget"
        command={h.toArgs((on: boolean) => ({ enabled: on }), {
          label: "Auto-retarget",
        })}
        state={false}
        unavailable={unavailable(s, "Antenna not reported")}
      />
    </Act>
  );
}

function SelectCell({ s }: { s: Scenario }) {
  const h = handleFor(s);
  return (
    <Act s={s}>
      <Select
        aria-label="Mode"
        value="a"
        command={h.toArgs((mode: string) => ({ mode }), { label: "Set mode" })}
        unavailable={unavailable(s, "Mode not reported")}
      >
        <option value="a">Prograde</option>
        <option value="b">Retrograde</option>
      </Select>
    </Act>
  );
}

function TextCell({ s }: { s: Scenario }) {
  const h = handleFor(s);
  return (
    <Act s={s}>
      <TextField
        label="Name"
        value="Kerbal I"
        command={h.toArgs((name: string) => ({ name }), { label: "Rename" })}
        unavailable={unavailable(s, "Vessel not controllable")}
      />
    </Act>
  );
}

function SliderCell({ s }: { s: Scenario }) {
  const h = handleFor(s);
  return (
    <Act s={s}>
      <Slider
        aria-label="Throttle"
        value={0.4}
        min={0}
        max={1}
        step={0.01}
        figure={(v) => `${Math.round(v * 100)}%`}
        command={h.toArgs((level: number) => ({ level }), {
          label: "Set throttle",
        })}
        unavailable={unavailable(s, "Vessel not controllable")}
      />
    </Act>
  );
}

function StepperCell({ s }: { s: Scenario }) {
  const h = handleFor(s);
  return (
    <Act s={s}>
      <Stepper
        label="RPM cap"
        min={0}
        max={460}
        step={10}
        value={340}
        format={(v) => `${v} rpm`}
        command={h.toArgs((rpm: number) => ({ rpm }), { label: "Set RPM cap" })}
        unavailable={unavailable(s, "RPM cap not reported")}
      />
    </Act>
  );
}

function RowCell({ s }: { s: Scenario }) {
  const h = handleFor(s);
  return (
    <Act s={s}>
      <Row
        as="button"
        interactive
        command={h.with(undefined, { label: "Target Mun" })}
        unavailable={unavailable(s, "No vessel") ?? undefined}
      >
        <RowName>Mun</RowName>
      </Row>
    </Act>
  );
}

function MenuCell({ s }: { s: Scenario }) {
  const h = handleFor(s);
  const other = handleFor("rest");
  return (
    <Act s={s}>
      <ActionMenu
        aria-label="Chute"
        style={{ position: "static", minWidth: 0, width: "100%" }}
        items={[
          {
            key: "deploy",
            label: "Deploy chute",
            command: other.with(undefined, { label: "Deploy chute" }),
          },
          {
            key: "cut",
            label: "Cut chute",
            command: h.with(undefined, { label: "Cut chute" }),
            unavailable: unavailable(s, "Chute not deployed") ?? undefined,
          },
          {
            key: "repack",
            label: "Repack chute",
            command: other.with(undefined, { label: "Repack chute" }),
          },
        ]}
        onSelect={() => {}}
        onDismiss={() => {}}
      />
    </Act>
  );
}

/** A part's action menu as the Ship Map opens it, at the menu's own width, before and after the press. */
function RealMenu({ s }: { s: Scenario }) {
  const h = handleFor(s);
  const other = handleFor("rest");
  return (
    <div
      data-real-menu={s}
      style={{ position: "relative", width: 240, height: 150 }}
    >
      <Text level="muted" size="xs">
        {s}
      </Text>
      <Act s={s}>
        <ActionMenu
          aria-label="Part actions"
          style={{ position: "absolute", top: 20, left: 0 }}
          items={[
            {
              key: "deploy",
              label: "Deploy",
              command: other.with(undefined, { label: "Deploy" }),
            },
            {
              key: "cut",
              label: "Cut chute",
              command: h.with(undefined, { label: "Cut chute" }),
            },
            {
              key: "repack",
              label: "Repack",
              command: other.with(undefined, { label: "Repack" }),
            },
          ]}
          onSelect={() => {}}
          onDismiss={() => {}}
        />
      </Act>
    </div>
  );
}

/** The rotor tachometer's control rows at the widget's default width, at rest beside after the press. */
function RealLayout({ s }: { s: Scenario }) {
  return (
    <div
      data-real={s}
      style={{
        width: 320,
        display: "grid",
        gridTemplateColumns: "auto 1fr",
        alignItems: "center",
        gap: "var(--gap-related)",
        padding: "var(--inset-placeholder)",
        background: "var(--color-surface-panel)",
      }}
    >
      <Text level="muted" size="xs">
        RPM cap
      </Text>
      <StepperCell s={s} />
      <Text level="muted" size="xs">
        Throttle
      </Text>
      <SliderCell s={s} />
    </div>
  );
}

function Harness() {
  const rows: [string, (s: Scenario) => React.ReactNode][] = [
    ["Switch", (s) => <SwitchCell s={s} />],
    ["Select", (s) => <SelectCell s={s} />],
    ["Text field", (s) => <TextCell s={s} />],
    ["Slider", (s) => <SliderCell s={s} />],
    ["Stepper", (s) => <StepperCell s={s} />],
    ["Row", (s) => <RowCell s={s} />],
    ["Menu item", (s) => <MenuCell s={s} />],
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
            <Text key={s} level="muted" size="xs">
              {s}
            </Text>
          ))}
        </div>
        {rows.map(([name, draw]) => (
          <div key={name}>
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
      <div
        style={{
          display: "flex",
          gap: 24,
          padding: "var(--inset-placeholder)",
        }}
        id="real"
      >
        <RealMenu s="rest" />
        <RealMenu s="sent" />
        <RealMenu s="refused" />
        <RealLayout s="rest" />
        <RealLayout s="sent" />
      </div>
    </DelayRailProvider>
  );
}

async function renderInputs(payload: InputsPayload): Promise<void> {
  const root = document.getElementById("root");
  if (!root) throw new Error("Command inputs probe: #root missing");
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
    __renderCommandInputs: typeof renderInputs;
  }
}

window.__renderCommandInputs = renderInputs;
