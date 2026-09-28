import type { ComponentProps } from "@ksp-gonogo/sitrep-sdk";
import {
  registerComponent,
  stillTrue,
  useActionInput,
  useCommand,
  useTelemetry,
} from "@ksp-gonogo/sitrep-sdk";
import { EmptyState, Panel, Section } from "@ksp-gonogo/ui-kit";
import { useState } from "react";
import { emptyStateText } from "../robotics";
import { BREAKING_GROUND } from "../uplink";
import { type RoboticsConsoleActions, roboticsActions } from "./actions";
import { RoboticsConsoleView } from "./RoboticsConsoleView";
import {
  formatPos,
  parseServos,
  type ServoInfo,
  type ServoType,
  TARGET_STEP,
  unitFor,
  withholdVerdicts,
} from "./servos";

export type { RoboticsConsoleActions } from "./actions";
export type { ServoInfo, ServoType } from "./servos";
export { parseServos } from "./servos";

/**
 * The active vessel's robotic hinges, rotation servos and pistons, with current-vs-target position and motor and lock controls.
 * The selected joint (first by default) gets the target stepper and the serial actions; rotors belong to Rotor Tachometer.
 */
type RoboticsConsoleConfig = Record<string, never>;

function RoboticsConsoleComponent({
  h,
}: Readonly<ComponentProps<RoboticsConsoleConfig>>) {
  // The list is held through stale, and each drawn position carries its field reading, so a held one is marked.
  const roboticsReading = useTelemetry("robotics.servos");
  const roboticsRaw = stillTrue(roboticsReading, undefined);
  // Two different facts: whether this craft carries a robotic part, and whether the install has the expansion.
  const available = stillTrue(
    useTelemetry("robotics.available"),
    undefined,
  )?.available;
  const breakingGround = stillTrue(
    useTelemetry("game.dlc"),
    undefined,
  )?.breakingGround;

  const targetCmd = useCommand("robotics.servo.setTarget");
  const motorCmd = useCommand("robotics.servo.setMotor");
  const lockCmd = useCommand("robotics.servo.setLock");

  const servos =
    roboticsReading.state === "stale"
      ? withholdVerdicts(parseServos(roboticsRaw))
      : parseServos(roboticsRaw);
  const positionReadings = (s: ServoInfo) => {
    const entry = roboticsReading[s.srcIndex];
    if (s.type === "piston")
      return { current: entry.currentExtension, target: entry.targetExtension };
    return { current: entry.currentAngle, target: entry.targetAngle };
  };
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected =
    servos.find((s) => s.partId === selectedId) ?? servos[0] ?? null;

  // Type-formatted, so a piston is not commanded to a whole metre.
  const setTarget = (id: string, type: ServoType, value: number) =>
    void targetCmd.send(
      { partId: id, value: Number(formatPos(type, value)) },
      { label: `Target ${formatPos(type, value)}${unitFor(type)}` },
    );
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

  useActionInput<RoboticsConsoleActions>({
    // The nudges are relative, so they dispatch nothing while the target is unread.
    targetUp: (p) => {
      if (p.kind === "button" && p.value !== true) return undefined;
      if (!selected || selected.target === null) return undefined;
      const next = selected.target + TARGET_STEP[selected.type];
      setTarget(selected.partId, selected.type, next);
      return { Target: next };
    },
    targetDown: (p) => {
      if (p.kind === "button" && p.value !== true) return undefined;
      if (!selected || selected.target === null) return undefined;
      const next = selected.target - TARGET_STEP[selected.type];
      setTarget(selected.partId, selected.type, next);
      return { Target: next };
    },
    // Motor and lock send an absolute state inverted from the one read back, so an unread flag dispatches nothing.
    toggleMotor: (p) => {
      if (p.kind === "button" && p.value !== true) return undefined;
      if (!selected || selected.motorEngaged === null) return undefined;
      setMotor(selected.partId, !selected.motorEngaged);
      return { Motor: !selected.motorEngaged };
    },
    toggleLock: (p) => {
      if (p.kind === "button" && p.value !== true) return undefined;
      if (!selected || selected.locked === null) return undefined;
      setLock(selected.partId, !selected.locked);
      return { Locked: !selected.locked };
    },
  });

  if (servos.length === 0 || !selected) {
    return (
      <Panel
        panelTitle="ROBOTICS"
        sections={
          <Section>
            <EmptyState role="status">
              {emptyStateText(
                breakingGround,
                available,
                roboticsReading.state === "observed" ||
                  roboticsReading.state === "stale",
                "robotic parts",
              )}
            </EmptyState>
          </Section>
        }
      />
    );
  }

  return (
    <RoboticsConsoleView
      servos={servos}
      selected={selected}
      positionReadings={positionReadings}
      rows={h ?? 8}
      onSelect={setSelectedId}
      setTarget={setTarget}
      setMotor={setMotor}
      setLock={setLock}
    />
  );
}

registerComponent<RoboticsConsoleConfig>({
  id: "robotics-console",
  name: "Robotics Console",
  description:
    "Current-vs-target position, at-target state and motor/lock controls for Breaking Ground robotic hinges, rotation servos and pistons. Select a joint to drive it from the stepper or a mapped input.",
  tags: ["telemetry", "robotics"],
  defaultSize: { w: 5, h: 8 },
  minSize: { w: 4, h: 4 },
  component: RoboticsConsoleComponent,
  dataRequirements: [
    "robotics.servos",
    "robotics.available.available",
    "game.dlc.breakingGround",
  ],
  defaultConfig: {},
  actions: roboticsActions,
  pushable: true,
  requires: ["flight"],
  owner: BREAKING_GROUND,
});

export { RoboticsConsoleComponent };
