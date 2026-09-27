import type { ComponentProps } from "@ksp-gonogo/sitrep-sdk";
import {
  value as quantity,
  registerComponent,
  stillTrue,
  useActionInput,
  useCommand,
  useTelemetry,
} from "@ksp-gonogo/sitrep-sdk";
import {
  EmptyState,
  Panel,
  Section,
  SelectableRow,
  Unit,
  UnitSharedFormat,
  usePanelDelay,
  writeQuantity,
} from "@ksp-gonogo/ui-kit";
import { useState } from "react";
import { emptyStateText } from "../robotics";
import { BREAKING_GROUND } from "../uplink";
import { type RotorTachometerActions, rotorActions } from "./actions";
import { RotorControls } from "./RotorControls";
import { RotorGauge } from "./RotorGauge";
import {
  clamp,
  parseRotors,
  ROTOR_MAX_RPM,
  type RotorInfo,
  RPM_STEP,
} from "./rotors";

export type { RotorTachometerActions } from "./actions";
export type { RotorInfo } from "./rotors";
export { parseRotors } from "./rotors";

/**
 * The active vessel's robotic rotors, with live RPM against the commanded cap and motor, lock, brake and direction controls.
 * The selected rotor (first by default) gets the dial and the serial actions.
 */
type RotorTachometerConfig = Record<string, never>;

function RotorTachometerComponent({
  h,
}: Readonly<ComponentProps<RotorTachometerConfig>>) {
  const roboticsReading = useTelemetry("robotics.servos");
  const roboticsRaw = stillTrue(roboticsReading, undefined);
  // Two different facts: whether this craft carries a robotic part (delayed, per vessel), and whether the install has the expansion (ground-side).
  const available = stillTrue(
    useTelemetry("robotics.available"),
    undefined,
  )?.available;
  const breakingGround = stillTrue(
    useTelemetry("game.dlc"),
    undefined,
  )?.breakingGround;

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
    // The steppers are relative, so they dispatch nothing while the cap is unread.
    rpmUp: (p) => {
      if (p.kind === "button" && p.value !== true) return undefined;
      if (!selected || selected.rpmLimit === null) return undefined;
      const next = clamp(selected.rpmLimit + RPM_STEP, 0, ROTOR_MAX_RPM);
      setRpmLimit(selected.partId, next);
      return { RPM: next };
    },
    rpmDown: (p) => {
      if (p.kind === "button" && p.value !== true) return undefined;
      if (!selected || selected.rpmLimit === null) return undefined;
      const next = clamp(selected.rpmLimit - RPM_STEP, 0, ROTOR_MAX_RPM);
      setRpmLimit(selected.partId, next);
      return { RPM: next };
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
    reverse: (p) => {
      if (p.kind === "button" && p.value !== true) return undefined;
      if (!selected) return undefined;
      // Reverse carries no value, so it stays available on an unread heading, but reports no heading back.
      reverse(selected.partId);
      return selected.counterClockwise === null
        ? undefined
        : { Direction: selected.counterClockwise ? "CW" : "CCW" };
    },
  });

  if (rotors.length === 0 || !selected) {
    return (
      <Panel
        panelTitle="ROTORS"
        sections={
          <Section>
            <EmptyState role="status">
              {emptyStateText(
                breakingGround,
                available,
                roboticsReading.state === "observed" ||
                  roboticsReading.state === "stale",
                "rotors",
              )}
            </EmptyState>
          </Section>
        }
      />
    );
  }

  const showGauge = (h ?? 8) >= 6;
  const readingsOf = (r: RotorInfo) => roboticsReading[r.srcIndex];

  return (
    <Panel
      panelTitle="ROTORS"
      sections={[
        showGauge && (
          <RotorGauge
            key="gauge"
            rotor={selected}
            rpmReading={readingsOf(selected).currentRPM}
            rows={h}
          />
        ),
        <RotorControls
          key="controls"
          selected={selected}
          torqueReading={readingsOf(selected).servoMotorLimit}
          setRpmLimit={setRpmLimit}
          setTorqueLimit={setTorqueLimit}
          setBrake={setBrake}
          setMotor={setMotor}
          setLock={setLock}
          reverse={reverse}
        />,
        rotors.length > 1 && (
          <Section key="rotors" gap="related-dense" aria-label="Rotors">
            {rotors.map((r) => (
              <SelectableRow
                key={r.partId}
                selected={r.partId === selected.partId}
                onClick={() => setSelectedId(r.partId)}
              >
                <span>{r.name}</span>
                <span>
                  {/* One shared scope, so both halves land on the same rung and the symbol is drawn once. */}
                  <UnitSharedFormat>
                    <Unit
                      value={readingsOf(r).currentRPM}
                      decimals={0}
                      hideUnitInGroup
                    />
                    /
                    <Unit value={readingsOf(r).rpmLimit} decimals={0} />
                  </UnitSharedFormat>
                  {r.motorEngaged === false ? " · off" : ""}
                  {r.locked === true ? " · locked" : ""}
                </span>
              </SelectableRow>
            ))}
          </Section>
        ),
      ]}
    />
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
  dataRequirements: [
    "robotics.servos",
    "robotics.available.available",
    "game.dlc.breakingGround",
  ],
  defaultConfig: {},
  actions: rotorActions,
  pushable: true,
  requires: ["flight"],
  owner: BREAKING_GROUND,
});

export { RotorTachometerComponent };
