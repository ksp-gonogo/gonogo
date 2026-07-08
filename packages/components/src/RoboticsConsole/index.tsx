import type { ActionDefinition, ComponentProps } from "@gonogo/core";
import {
  registerComponent,
  useActionInput,
  useDataStreamStatus,
  useDataValue,
  useExecuteAction,
} from "@gonogo/core";
import {
  EmptyState,
  Panel,
  PanelTitle,
  StreamStatusBadge,
  ToggleButton,
} from "@gonogo/ui";
import { useState } from "react";
import styled from "styled-components";

/**
 * Robotics Console (Breaking Ground). Lists the active vessel's robotic
 * hinges, rotation servos and pistons with current-vs-target position, an
 * at-target indicator, and motor / lock controls. The selected joint (first
 * by default) gets a target stepper and is the target of the serial actions.
 * Rotors live in the separate Rotor Tachometer widget.
 *
 * Reads `robotics.servos` + `robotics.available`; degrades to a muted empty
 * state without Breaking Ground or when no servo is present.
 *
 * M3 science/parts batch: the identity list (partId-keyed selection +
 * commands) stays entirely on `robotics.servos` — `parts.robotics`
 * (map-topic.ts) carries the same live hinge readouts. `mergeServo` below
 * merges the live numeric fields onto the selected legacy servo, chosen by
 * `selectLiveServoEntry`.
 *
 * M3 whole-branch review #1: `parts.robotics` originally carried no stable
 * id, so the join was BY NAME — a `.find`, first-match-wins. Symmetric
 * arms/legs are commonly N identically-named parts, so a name join could
 * silently attribute a DIFFERENT joint's live reading to the selected one.
 * `selectLiveServoEntry` now prefers a stable `partId` join when the wire
 * carries one, and — since the wire may still lag that capture change —
 * falls back to a name join ONLY when the name is unique among the
 * streamed (non-rotor) entries; an ambiguous name refuses to merge at all
 * (staying on the correct legacy value beats a confidently-wrong one).
 */

type RoboticsConsoleConfig = Record<string, never>;

const TARGET_STEP = 5;

export type ServoType = "hinge" | "rotation" | "piston";

export interface ServoInfo {
  partId: number;
  name: string;
  type: ServoType;
  current: number;
  target: number;
  atTarget: boolean;
  motorEngaged: boolean;
  locked: boolean;
  torqueLimit: number;
}

function num(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

const unitFor = (type: ServoType) => (type === "piston" ? "%" : "°");

/**
 * Parse `robotics.servos`. Returns null when the key is absent (older fork)
 * so the widget can tell "no DLC support" from "no servos on this vessel".
 */
export function parseServos(raw: unknown): ServoInfo[] | null {
  if (raw === null || raw === undefined) return null;
  if (!Array.isArray(raw)) return null;
  const out: ServoInfo[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const e = entry as Record<string, unknown>;
    if (typeof e.partId !== "number") continue;
    const type: ServoType =
      e.type === "rotation" || e.type === "piston" ? e.type : "hinge";
    out.push({
      partId: e.partId,
      name: typeof e.name === "string" ? e.name : `Servo ${e.partId}`,
      type,
      current: num(e.current),
      target: num(e.target),
      atTarget: e.atTarget === true,
      motorEngaged: e.motorEngaged === true,
      locked: e.locked === true,
      torqueLimit: num(e.torqueLimit),
    });
  }
  return out;
}

/**
 * `parts.robotics` entry shape (`mod/Sitrep.Host/PartsViewProvider.cs`) — a
 * raw array of BOTH hinges and rotors; RoboticsConsole only ever merges
 * `type !== "rotor"` entries (rotors are Rotor Tachometer's domain).
 * `partId` is `Part.flightID` STRINGIFIED (`Gonogo.KSP.KspHost`'s `partId =
 * part.flightID != 0 ? part.flightID.ToString() : null`) — a STRING, unlike
 * the legacy `robotics.servos` list's numeric `ServoInfo.partId` (the same
 * underlying flightID, just carried as a JS number there). Nullable/absent
 * on an older wire snapshot recorded before the stable-id capture change, or
 * when flightID read as the uninitialized 0 sentinel — `selectLiveServoEntry`
 * below handles both, comparing via `String(selected.partId)`.
 */
interface StreamServoEntry {
  partId?: string | null;
  partName: string;
  type: string;
  servoIsLocked: boolean | null;
  servoIsMotorized: boolean | null;
  servoMotorIsEngaged: boolean | null;
  servoMotorLimit: number | null;
  currentAngle: number | null;
  targetAngle: number | null;
}

/**
 * Picks the `parts.robotics` entry (if any) that live-updates `selected`.
 * See the module doc comment / M3 whole-branch review #1: prefer a stable
 * `partId` join (string-vs-number coerced — same underlying flightID, see
 * `StreamServoEntry`'s doc comment); only fall back to a name join when the
 * name is unique among the streamed (non-rotor) entries, and refuse to
 * merge at all when it's ambiguous — never let `.find`'s first-match-wins
 * attribute a sibling joint's reading to the selected one.
 */
export function selectLiveServoEntry(
  entries: StreamServoEntry[] | undefined,
  selected: ServoInfo,
): StreamServoEntry | undefined {
  if (!entries) return undefined;
  const servoEntries = entries.filter((e) => e.type !== "rotor");

  const selectedId = String(selected.partId);
  const idMatches = servoEntries.filter(
    (e) => typeof e.partId === "string" && e.partId === selectedId,
  );
  if (idMatches.length > 0) return idMatches[0];

  const nameMatches = servoEntries.filter((e) => e.partName === selected.name);
  return nameMatches.length === 1 ? nameMatches[0] : undefined;
}

/** Merges live `parts.robotics` numeric/boolean fields onto a legacy
 * `ServoInfo` by name. Identity (`partId`, `type`) always stays from
 * `base` — only the values a physical servo's live state actually is are
 * candidates for the stream's fresher read, each independently `??`-falling
 * back to the legacy value when the stream field is absent. */
function mergeServo(
  base: ServoInfo,
  live: StreamServoEntry | undefined,
): ServoInfo {
  if (!live) return base;
  return {
    ...base,
    current:
      typeof live.currentAngle === "number" ? live.currentAngle : base.current,
    target:
      typeof live.targetAngle === "number" ? live.targetAngle : base.target,
    motorEngaged:
      typeof live.servoMotorIsEngaged === "boolean"
        ? live.servoMotorIsEngaged
        : base.motorEngaged,
    locked:
      typeof live.servoIsLocked === "boolean"
        ? live.servoIsLocked
        : base.locked,
    torqueLimit:
      typeof live.servoMotorLimit === "number"
        ? live.servoMotorLimit
        : base.torqueLimit,
  };
}

const roboticsActions = [
  {
    id: "targetUp",
    label: "Target +",
    accepts: ["button"],
    description: "Increase the selected joint's target.",
  },
  {
    id: "targetDown",
    label: "Target −",
    accepts: ["button"],
    description: "Decrease the selected joint's target.",
  },
  {
    id: "toggleMotor",
    label: "Toggle motor",
    accepts: ["button"],
    description: "Engage / disengage the selected joint's motor.",
  },
  {
    id: "toggleLock",
    label: "Toggle lock",
    accepts: ["button"],
    description: "Lock / unlock the selected joint.",
  },
] as const satisfies readonly ActionDefinition[];

export type RoboticsConsoleActions = typeof roboticsActions;

function RoboticsConsoleComponent(
  _: Readonly<ComponentProps<RoboticsConsoleConfig>>,
) {
  const servosRaw = useDataValue("data", "robotics.servos");
  const available = useDataValue<boolean>("data", "robotics.available");
  const execute = useExecuteAction("data");
  const streamServos = useDataValue<StreamServoEntry[]>(
    "data",
    "parts.robotics",
  );
  const streamStatus = useDataStreamStatus("data", "parts.robotics");

  const servos = parseServos(servosRaw) ?? [];
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const rawSelected =
    servos.find((s) => s.partId === selectedId) ?? servos[0] ?? null;
  const liveEntry = rawSelected
    ? selectLiveServoEntry(streamServos, rawSelected)
    : undefined;
  const selected = rawSelected ? mergeServo(rawSelected, liveEntry) : null;

  const setTarget = (id: number, value: number) =>
    void execute(`robotics.servo.setTarget[${id},${Math.round(value)}]`);
  const setMotor = (id: number, engaged: boolean) =>
    void execute(`robotics.servo.setMotor[${id},${engaged}]`);
  const setLock = (id: number, locked: boolean) =>
    void execute(`robotics.servo.setLock[${id},${locked}]`);

  useActionInput<RoboticsConsoleActions>({
    targetUp: (p) => {
      if (p.kind === "button" && p.value !== true) return undefined;
      if (!selected) return undefined;
      const next = selected.target + TARGET_STEP;
      setTarget(selected.partId, next);
      return { Target: next };
    },
    targetDown: (p) => {
      if (p.kind === "button" && p.value !== true) return undefined;
      if (!selected) return undefined;
      const next = selected.target - TARGET_STEP;
      setTarget(selected.partId, next);
      return { Target: next };
    },
    toggleMotor: (p) => {
      if (p.kind === "button" && p.value !== true) return undefined;
      if (!selected) return undefined;
      setMotor(selected.partId, !selected.motorEngaged);
      return { Motor: !selected.motorEngaged };
    },
    toggleLock: (p) => {
      if (p.kind === "button" && p.value !== true) return undefined;
      if (!selected) return undefined;
      setLock(selected.partId, !selected.locked);
      return { Locked: !selected.locked };
    },
  });

  if (servos.length === 0 || !selected) {
    return (
      <Panel>
        <TitleRow>
          <PanelTitle>ROBOTICS</PanelTitle>
          <StreamStatusBadge status={streamStatus} />
        </TitleRow>
        <EmptyState role="status">
          {available === false
            ? "Breaking Ground not installed"
            : "No robotic parts on this vessel"}
        </EmptyState>
      </Panel>
    );
  }

  const unit = unitFor(selected.type);

  return (
    <Panel>
      <TitleRow>
        <PanelTitle>ROBOTICS</PanelTitle>
        <StreamStatusBadge status={streamStatus} />
      </TitleRow>
      <Body>
        <Readout>
          <Current>
            {Math.round(selected.current)}
            <Unit>{unit}</Unit>
          </Current>
          <Arrow aria-hidden="true">→</Arrow>
          <Target>
            {Math.round(selected.target)}
            <Unit>{unit}</Unit>
          </Target>
          <StatePill $atTarget={selected.atTarget} role="status">
            {selected.atTarget ? "AT TARGET" : "MOVING"}
          </StatePill>
        </Readout>

        <Controls>
          <ControlRow>
            <ControlLabel>Target</ControlLabel>
            <Stepper>
              <StepBtn
                type="button"
                aria-label="Decrease target"
                onClick={() =>
                  setTarget(selected.partId, selected.target - TARGET_STEP)
                }
              >
                −
              </StepBtn>
              <StepValue>
                {Math.round(selected.target)}
                {unit}
              </StepValue>
              <StepBtn
                type="button"
                aria-label="Increase target"
                onClick={() =>
                  setTarget(selected.partId, selected.target + TARGET_STEP)
                }
              >
                +
              </StepBtn>
            </Stepper>
          </ControlRow>

          <ToggleRow>
            <ToggleButton
              size="sm"
              active={selected.motorEngaged}
              tone="go"
              onClick={() => setMotor(selected.partId, !selected.motorEngaged)}
            >
              Motor {selected.motorEngaged ? "on" : "off"}
            </ToggleButton>
            <ToggleButton
              size="sm"
              active={selected.locked}
              tone="warn"
              onClick={() => setLock(selected.partId, !selected.locked)}
            >
              {selected.locked ? "Locked" : "Unlocked"}
            </ToggleButton>
          </ToggleRow>
        </Controls>

        {servos.length > 1 && (
          <ServoList aria-label="Robotic joints">
            {servos.map((s) => (
              <ServoRow
                key={s.partId}
                type="button"
                $selected={s.partId === selected.partId}
                aria-pressed={s.partId === selected.partId}
                onClick={() => setSelectedId(s.partId)}
              >
                <ServoName>{s.name}</ServoName>
                <ServoMeta>
                  {s.type} · {Math.round(s.current)}
                  {unitFor(s.type)}/{Math.round(s.target)}
                  {unitFor(s.type)}
                  {s.locked ? " · locked" : s.atTarget ? " · ✓" : ""}
                </ServoMeta>
              </ServoRow>
            ))}
          </ServoList>
        )}
      </Body>
    </Panel>
  );
}

const TitleRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
`;

const Body = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 4px 8px 8px;
  overflow: auto;
`;

const Readout = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px;
`;

const Current = styled.span`
  font-size: 22px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
`;

const Arrow = styled.span`
  color: var(--color-text-secondary);
`;

const Target = styled.span`
  font-size: 16px;
  color: var(--color-text-secondary);
  font-variant-numeric: tabular-nums;
`;

const Unit = styled.span`
  font-size: 0.6em;
  opacity: 0.7;
  margin-left: 1px;
`;

const StatePill = styled.span<{ $atTarget: boolean }>`
  margin-left: auto;
  align-self: center;
  font-size: 9px;
  letter-spacing: 0.06em;
  padding: 1px 6px;
  border-radius: 2px;
  background: ${(p) =>
    p.$atTarget ? "var(--color-status-go-bg)" : "var(--color-surface-raised)"};
  color: ${(p) =>
    p.$atTarget ? "var(--color-status-go-fg)" : "var(--color-text-secondary)"};
`;

const Controls = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const ControlRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px 8px;
  flex-wrap: wrap;
`;

const ControlLabel = styled.span`
  font-size: 10px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-text-secondary);
`;

const Stepper = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
`;

const StepBtn = styled.button`
  min-width: 26px;
  padding: 2px 6px;
  background: var(--color-surface-panel);
  color: var(--color-text-primary);
  border: 1px solid var(--color-surface-raised);
  border-radius: 2px;
  cursor: pointer;
  font-family: inherit;
  font-size: 14px;
  line-height: 1;
`;

const StepValue = styled.span`
  min-width: 52px;
  text-align: center;
  font-variant-numeric: tabular-nums;
  font-size: 12px;
`;

const ToggleRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
`;

const ServoList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const ServoRow = styled.button<{ $selected: boolean }>`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 1px;
  padding: 4px 8px;
  background: ${(p) =>
    p.$selected ? "var(--color-status-go-bg)" : "var(--color-surface-panel)"};
  color: ${(p) =>
    p.$selected ? "var(--color-status-go-fg)" : "var(--color-text-primary)"};
  border: 1px solid
    ${(p) => (p.$selected ? "transparent" : "var(--color-surface-raised)")};
  border-radius: 2px;
  cursor: pointer;
  text-align: left;
  font-family: inherit;
`;

const ServoName = styled.span`
  font-size: 11px;
  font-weight: 600;
`;

const ServoMeta = styled.span`
  font-size: 9px;
  opacity: 0.7;
  letter-spacing: 0.03em;
  font-variant-numeric: tabular-nums;
`;

registerComponent<RoboticsConsoleConfig>({
  id: "robotics-console",
  name: "Robotics Console",
  description:
    "Current-vs-target position, at-target state and motor/lock controls for Breaking Ground robotic hinges, rotation servos and pistons. Select a joint to drive it from the stepper or a mapped input.",
  tags: ["telemetry", "robotics"],
  defaultSize: { w: 5, h: 8 },
  minSize: { w: 4, h: 4 },
  component: RoboticsConsoleComponent,
  dataRequirements: ["robotics.servos", "robotics.available", "parts.robotics"],
  defaultConfig: {},
  actions: roboticsActions,
  pushable: true,
  requires: ["flight"],
});

export { RoboticsConsoleComponent };
