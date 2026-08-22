import type {
  ActionDefinition,
  ComponentProps,
  Reading,
} from "@ksp-gonogo/sitrep-sdk";
import {
  value as quantity,
  registerComponent,
  useActionInput,
  useCommand,
  useTelemetry,
} from "@ksp-gonogo/sitrep-sdk";
import {
  ActionButton,
  Cluster,
  EmptyState,
  Gauge,
  Inline,
  magnitudeOr,
  Panel,
  type Quantityish,
  ReadoutCaption,
  ScrollArea,
  SelectableRow,
  Stack,
  Text,
  ToggleButton,
  Unit,
  useElementSize,
  usePanelDelay,
  writeQuantity,
} from "@ksp-gonogo/ui-kit";
import { useState } from "react";
import { BREAKING_GROUND } from "../uplink";

/**
 * Rotor Tachometer (Breaking Ground). Lists the active vessel's robotic
 * rotors and shows live RPM against the commanded cap, with motor / lock /
 * brake / direction controls. The selected rotor (first by default) gets a
 * tachometer dial and is the target of the serial-mappable actions.
 *
 * Reads `robotics.servos` (the rotor identity list, filtered by `type ===
 * "rotor"`) + `robotics.available`; degrades to a muted empty state without
 * Breaking Ground or when no rotor is present.
 */

type RotorTachometerConfig = Record<string, never>;

const ROTOR_MAX_RPM = 460; // ModuleRoboticServoRotor.rpmLimit range ceiling.
const RPM_STEP = 10;
const TORQUE_STEP = 10;

export interface RotorInfo {
  partId: string;
  name: string;
  rpm: number;
  rpmLimit: number;
  torqueLimit: number;
  maxTorque: number;
  brakePercentage: number;
  motorEngaged: boolean;
  locked: boolean;
  counterClockwise: boolean;
  output: number;
}

/**
 * The value a VERDICT may be drawn from: current, or modelled forward to the frame.
 * A stale reading gives nothing, because a judgement cannot be dated: the operator
 * reads a band or a pill as the situation NOW.
 */
function judgeable<T>(reading: Reading<T>): T | undefined {
  if (reading.state === "observed") return reading.value;
  if (reading.state === "reckonable") return reading.reckoned.value;
  return undefined;
}

/**
 * The value of a FACT: something that stays true until an event changes it, and no
 * event can reach us down a link that is not delivering. `whenConfirmedNothing` is
 * what an `absent` tombstone means here, which is a different answer from `pending`
 * and must not collapse into it.
 */
function stillTrue<T, A>(
  reading: Reading<T>,
  whenConfirmedNothing: A,
): T | A | undefined {
  if (reading.state === "observed") return reading.value;
  if (reading.state === "stale") return reading.value;
  if (reading.state === "reckonable") return reading.value;
  if (reading.state === "absent") return whenConfirmedNothing;
  return undefined;
}

/**
 * A wire field as a number.
 *
 * Takes a `Value` as well as a bare number: a declared quantity arrives
 * wrapped from the decode, and a `typeof === "number"` test answers "no
 * reading" for every one of them, which is silent and total.
 */
function num(v: unknown, fallback = 0): number {
  return magnitudeOr(v as Quantityish, fallback);
}

/**
 * Parses the `robotics.servos` bare array (`mod/Sitrep.Host/PartsViewProvider.cs`)
 * down to `type === "rotor"` entries (hinges/pistons are Robotics Console's
 * domain). `partId` is `Part.flightID` stringified, stable per-part for the
 * life of the flight and, unlike `partName`, unique even among symmetric
 * same-named parts (multirotors, coaxial helis). Entries with no string
 * `partId` are dropped, they can't be selected or targeted safely.
 */
export function parseRotors(raw: unknown): RotorInfo[] {
  if (!Array.isArray(raw)) return [];
  const out: RotorInfo[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const e = entry as Record<string, unknown>;
    if (e.type !== "rotor") continue;
    if (typeof e.partId !== "string") continue;
    out.push({
      partId: e.partId,
      name: typeof e.partName === "string" ? e.partName : `Rotor ${e.partId}`,
      rpm: num(e.currentRPM),
      rpmLimit: num(e.rpmLimit),
      torqueLimit: num(e.servoMotorLimit),
      maxTorque: num(e.maxTorque),
      brakePercentage: num(e.brakePercentage),
      motorEngaged: e.servoMotorIsEngaged === true,
      locked: e.servoIsLocked === true,
      counterClockwise: e.counterClockwise === true,
      output: num(e.normalizedOutput),
    });
  }
  return out;
}

const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));

const rotorActions = [
  {
    id: "rpmUp",
    label: "RPM up",
    accepts: ["button"],
    description: "Raise the selected rotor's RPM cap.",
  },
  {
    id: "rpmDown",
    label: "RPM down",
    accepts: ["button"],
    description: "Lower the selected rotor's RPM cap.",
  },
  {
    id: "toggleMotor",
    label: "Toggle motor",
    accepts: ["button"],
    description: "Engage / disengage the selected rotor's motor.",
  },
  {
    id: "toggleLock",
    label: "Toggle lock",
    accepts: ["button"],
    description: "Lock / unlock the selected rotor.",
  },
  {
    id: "reverse",
    label: "Reverse",
    accepts: ["button"],
    description: "Flip the selected rotor's spin direction.",
  },
] as const satisfies readonly ActionDefinition[];

export type RotorTachometerActions = typeof rotorActions;

function RotorTachometerComponent({
  h,
}: Readonly<ComponentProps<RotorTachometerConfig>>) {
  // An RPM gauge is read as the situation now, so it is withheld rather than held.
  const roboticsRaw = judgeable(useTelemetry("robotics.servos"));
  const available = stillTrue(
    useTelemetry("robotics.available"),
    undefined,
  )?.available;

  // Rotor RPM, torque, brake, motor, lock and direction are all actuated on the
  // craft and so are subject to signal delay. Each dispatches over
  // `useCommand`, which carries per-command in-flight state, the same shape
  // RoboticsConsole and MechJeb use.
  const rpmCmd = useCommand("robotics.rotor.setRpmLimit");
  const torqueCmd = useCommand("robotics.rotor.setTorqueLimit");
  const brakeCmd = useCommand("robotics.rotor.setBrake");
  const motorCmd = useCommand("robotics.rotor.setMotor");
  const lockCmd = useCommand("robotics.rotor.setLock");
  const reverseCmd = useCommand("robotics.rotor.reverse");
  usePanelDelay(rpmCmd);
  usePanelDelay(torqueCmd);
  usePanelDelay(brakeCmd);
  usePanelDelay(motorCmd);
  usePanelDelay(lockCmd);
  usePanelDelay(reverseCmd);

  // Measure the gauge slot so the dial follows the column width instead of a
  // fixed 180px that clips in a narrow slot.
  const { ref: gaugeRef, size: gaugeSize } = useElementSize({ w: 180, h: 104 });

  const rotors = parseRotors(roboticsRaw);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected =
    rotors.find((r) => r.partId === selectedId) ?? rotors[0] ?? null;

  const setRpmLimit = (id: string, rpm: number) => {
    const value = Math.round(clamp(rpm, 0, ROTOR_MAX_RPM));
    void rpmCmd.send({ partId: id, value }, { label: `RPM cap ${value}` });
  };
  const setTorqueLimit = (id: string, pct: number) => {
    const value = Math.round(clamp(pct, 0, 100));
    void torqueCmd.send(
      { partId: id, value },
      { label: `Torque ${writeQuantity(quantity("%", value))}` },
    );
  };
  const setBrake = (id: string, pct: number) => {
    const value = Math.round(clamp(pct, 0, 200));
    void brakeCmd.send(
      { partId: id, value },
      { label: `Brake ${writeQuantity(quantity("%", value))}` },
    );
  };
  const setMotor = (id: string, engaged: boolean) =>
    void motorCmd.send(
      { partId: id, enabled: engaged },
      { label: `Motor ${engaged ? "on" : "off"}` },
    );
  const setLock = (id: string, locked: boolean) =>
    void lockCmd.send(
      { partId: id, enabled: locked },
      { label: locked ? "Lock" : "Unlock" },
    );
  const reverse = (id: string) =>
    void reverseCmd.send({ partId: id }, { label: "Reverse" });

  useActionInput<RotorTachometerActions>({
    rpmUp: (p) => {
      if (p.kind === "button" && p.value !== true) return undefined;
      if (!selected) return undefined;
      const next = clamp(selected.rpmLimit + RPM_STEP, 0, ROTOR_MAX_RPM);
      setRpmLimit(selected.partId, next);
      return { RPM: next };
    },
    rpmDown: (p) => {
      if (p.kind === "button" && p.value !== true) return undefined;
      if (!selected) return undefined;
      const next = clamp(selected.rpmLimit - RPM_STEP, 0, ROTOR_MAX_RPM);
      setRpmLimit(selected.partId, next);
      return { RPM: next };
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
    reverse: (p) => {
      if (p.kind === "button" && p.value !== true) return undefined;
      if (!selected) return undefined;
      reverse(selected.partId);
      return { Direction: selected.counterClockwise ? "CW" : "CCW" };
    },
  });

  if (rotors.length === 0 || !selected) {
    return (
      <Panel panelTitle="ROTORS">
        <EmptyState role="status">
          {available === false
            ? "Breaking Ground not installed"
            : "No rotors on this vessel"}
        </EmptyState>
      </Panel>
    );
  }

  const showGauge = (h ?? 8) >= 6;
  const cap = Math.max(selected.rpmLimit, 1);
  // Size the dial to the column width, but also cap it by a slice of the
  // widget's height so the controls (steppers + the full toggle row) stay
  // visible without scrolling; the rotor list below may scroll. Kept modest
  // so a short/wide slot doesn't let the gauge crowd the toggles off-bottom.
  const gaugeMaxH = Math.max(64, (h ?? 9) * 25 * 0.32);
  const gaugeW = Math.min(
    gaugeSize.w || 180,
    240,
    Math.round(gaugeMaxH / 0.58),
  );
  const gaugeH = Math.round(gaugeW * 0.58);

  return (
    <Panel panelTitle="ROTORS">
      <ScrollArea>
        <Stack gap="md">
          {showGauge && (
            <Cluster justify="center" ref={gaugeRef}>
              <Gauge
                value={clamp(selected.rpm, 0, ROTOR_MAX_RPM)}
                min={0}
                max={ROTOR_MAX_RPM}
                width={gaugeW}
                height={gaugeH}
                valueLabel={`${Math.round(selected.rpm)}`}
                unitLabel="RPM"
                zones={[
                  { from: 0, to: cap, color: "var(--color-status-go-bg)" },
                  {
                    from: cap,
                    to: ROTOR_MAX_RPM,
                    color: "var(--color-surface-raised)",
                  },
                ]}
                ariaLabel={`${selected.name}: ${Math.round(selected.rpm)} RPM, cap ${Math.round(selected.rpmLimit)}`}
              />
            </Cluster>
          )}

          <Stack gap="sm">
            <Cluster justify="between" gap="md" wrap>
              <ReadoutCaption>RPM cap</ReadoutCaption>
              <Inline gap="sm">
                <ActionButton
                  tone="ghost"
                  type="button"
                  aria-label="Lower RPM cap"
                  onClick={() =>
                    setRpmLimit(selected.partId, selected.rpmLimit - RPM_STEP)
                  }
                >
                  −
                </ActionButton>
                <Text size="sm" tone="default">
                  {Math.round(selected.rpmLimit)}
                </Text>
                <ActionButton
                  tone="ghost"
                  type="button"
                  aria-label="Raise RPM cap"
                  onClick={() =>
                    setRpmLimit(selected.partId, selected.rpmLimit + RPM_STEP)
                  }
                >
                  +
                </ActionButton>
              </Inline>
            </Cluster>

            <Cluster justify="between" gap="md" wrap>
              <ReadoutCaption>Torque</ReadoutCaption>
              <Inline gap="sm">
                <ActionButton
                  tone="ghost"
                  type="button"
                  aria-label="Lower torque limit"
                  onClick={() =>
                    setTorqueLimit(
                      selected.partId,
                      selected.torqueLimit - TORQUE_STEP,
                    )
                  }
                >
                  −
                </ActionButton>
                <Text size="sm" tone="default">
                  <Unit
                    value={quantity("%", selected.torqueLimit)}
                    decimals={0}
                  />
                </Text>
                <ActionButton
                  tone="ghost"
                  type="button"
                  aria-label="Raise torque limit"
                  onClick={() =>
                    setTorqueLimit(
                      selected.partId,
                      selected.torqueLimit + TORQUE_STEP,
                    )
                  }
                >
                  +
                </ActionButton>
              </Inline>
            </Cluster>

            <Cluster justify="start" gap="sm" wrap>
              <ToggleButton
                size="sm"
                active={selected.motorEngaged}
                tone="go"
                onClick={() =>
                  setMotor(selected.partId, !selected.motorEngaged)
                }
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
              <ToggleButton
                size="sm"
                active={selected.brakePercentage > 0}
                tone="warn"
                onClick={() =>
                  setBrake(
                    selected.partId,
                    selected.brakePercentage > 0 ? 0 : 100,
                  )
                }
              >
                Brake {selected.brakePercentage > 0 ? "on" : "off"}
              </ToggleButton>
              <ToggleButton size="sm" onClick={() => reverse(selected.partId)}>
                {selected.counterClockwise ? "↺ CCW" : "↻ CW"}
              </ToggleButton>
            </Cluster>
          </Stack>

          {rotors.length > 1 && (
            <Stack gap="sm" aria-label="Rotors">
              {rotors.map((r) => (
                <SelectableRow
                  key={r.partId}
                  selected={r.partId === selected.partId}
                  onClick={() => setSelectedId(r.partId)}
                >
                  <span>{r.name}</span>
                  <span>
                    {Math.round(r.rpm)}/{Math.round(r.rpmLimit)} RPM
                    {r.motorEngaged ? "" : " · off"}
                    {r.locked ? " · locked" : ""}
                  </span>
                </SelectableRow>
              ))}
            </Stack>
          )}
        </Stack>
      </ScrollArea>
    </Panel>
  );
}

registerComponent<RotorTachometerConfig>({
  id: "rotor-tachometer",
  name: "Rotor Tachometer",
  description:
    "Live RPM vs commanded cap for Breaking Ground robotic rotors, with motor, lock, brake and direction controls. Select a rotor to drive it from the dial or a mapped input.",
  tags: ["telemetry", "robotics"],
  defaultSize: { w: 6, h: 10 },
  minSize: { w: 4, h: 4 },
  component: RotorTachometerComponent,
  dataRequirements: ["robotics.servos", "robotics.available.available"],
  defaultConfig: {},
  actions: rotorActions,
  pushable: true,
  requires: ["flight"],
  owner: BREAKING_GROUND,
});

export { RotorTachometerComponent };
