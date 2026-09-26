import type {
  ActionDefinition,
  ComponentProps,
  TopicReading,
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
  Panel,
  ReadoutCaption,
  Section,
  SelectableRow,
  Text,
  ToggleButton,
  Unit,
  UnitSharedFormat,
  useElementSize,
  usePanelDelay,
  writeQuantity,
} from "@ksp-gonogo/ui-kit";
import { useState } from "react";
import { emptyStateText } from "../robotics";
import { BREAKING_GROUND } from "../uplink";
import { boolOrNull, numOrNull } from "../wire";

/**
 * The active vessel's robotic rotors, with live RPM against the commanded cap and motor, lock, brake and direction controls.
 * The selected rotor (first by default) gets the dial and the serial actions.
 */

type RotorTachometerConfig = Record<string, never>;

const ROTOR_MAX_RPM = 460; // ModuleRoboticServoRotor.rpmLimit range ceiling.
const RPM_STEP = 10;
const TORQUE_STEP = 10;

/**
 * One rotor as this widget draws it.
 * Every figure is `null` when withheld: zero RPM is a stopped rotor, and the steppers command from these numbers.
 */
export interface RotorInfo {
  /**
   * Position in `robotics.servos` as delivered, not in the parsed list (the parse
   * drops non-rotor servos and entries without a `partId`), so a displayed figure
   * can be read back as a field reading with its currency. The numeric fields
   * below stay bare because the steppers command from them.
   */
  srcIndex: number;
  partId: string;
  name: string;
  rpm: number | null;
  rpmLimit: number | null;
  torqueLimit: number | null;
  maxTorque: number | null;
  brakePercentage: number | null;
  /** Unknown is never false: each false is a definite claim about the rotor. */
  motorEngaged: boolean | null;
  locked: boolean | null;
  counterClockwise: boolean | null;
  output: number | null;
}

/** A fact's value, held through stale; `whenConfirmedNothing` is what an `absent` tombstone means, distinct from `pending`. */
function stillTrue<T, A>(
  reading: TopicReading<T>,
  whenConfirmedNothing: A,
): T | A | undefined {
  if (reading.state === "observed") return reading.value;
  if (reading.state === "stale") return reading.value;
  if (reading.state === "absent") return whenConfirmedNothing;
  return undefined;
}

/**
 * Parses `robotics.servos` down to its rotors.
 * `partId` is the stringified `Part.flightID`, unique even among symmetric same-named parts; an entry without one cannot be targeted and is dropped.
 */
export function parseRotors(raw: unknown): RotorInfo[] {
  if (!Array.isArray(raw)) return [];
  const entries: unknown[] = raw;
  const out: RotorInfo[] = [];
  // `srcIndex` is the position in the delivered array, which the `continue`s make differ from the output position.
  for (const [srcIndex, entry] of entries.entries()) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const e = entry as Record<string, unknown>;
    if (e.type !== "rotor") continue;
    if (typeof e.partId !== "string") continue;
    out.push({
      srcIndex,
      partId: e.partId,
      name: typeof e.partName === "string" ? e.partName : `Rotor ${e.partId}`,
      rpm: numOrNull(e.currentRPM),
      rpmLimit: numOrNull(e.rpmLimit),
      torqueLimit: numOrNull(e.servoMotorLimit),
      maxTorque: numOrNull(e.maxTorque),
      brakePercentage: numOrNull(e.brakePercentage),
      motorEngaged: boolOrNull(e.servoMotorIsEngaged),
      locked: boolOrNull(e.servoIsLocked),
      counterClockwise: boolOrNull(e.counterClockwise),
      output: numOrNull(e.normalizedOutput),
    });
  }
  return out;
}

const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));

/** A relative stepper's accessible name, carrying why it is disabled when the figure it steps from was never read. */
const stepperLabel = (action: string, from: number | null): string =>
  from === null ? `${action} (unavailable, not reported)` : action;

/** The same, for a toggle whose `enabled` is the inverse of an unread flag. */
const flagLabel = (action: string, from: boolean | null): string | undefined =>
  from === null ? `${action} (unavailable, not reported)` : undefined;

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

  // The dial follows the column width so it does not clip in a narrow slot.
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
  const rpmReading = roboticsReading[selected.srcIndex].currentRPM;
  // With the cap unread the dial draws no zones rather than an arc ending at a substitute.
  const cap =
    selected.rpmLimit === null ? null : Math.max(selected.rpmLimit, 1);
  // Capped by a slice of the widget's height so the controls stay visible without scrolling.
  const gaugeMaxH = Math.max(64, (h ?? 9) * 25 * 0.32);
  const gaugeW = Math.min(
    gaugeSize.w || 180,
    240,
    Math.round(gaugeMaxH / 0.58),
  );
  const gaugeH = Math.round(gaugeW * 0.58);

  return (
    <Panel
      panelTitle="ROTORS"
      sections={[
        showGauge && (
          <Section key="gauge">
            <Cluster justify="center" ref={gaugeRef}>
              <Gauge
                value={rpmReading}
                min={quantity("rpm", 0)}
                max={quantity("rpm", ROTOR_MAX_RPM)}
                width={gaugeW}
                height={gaugeH}
                zones={
                  cap === null
                    ? undefined
                    : [
                        {
                          from: quantity("rpm", 0),
                          to: quantity("rpm", cap),
                          color: "var(--color-status-go-bg)",
                        },
                        {
                          from: quantity("rpm", cap),
                          to: quantity("rpm", ROTOR_MAX_RPM),
                          color: "var(--color-surface-raised)",
                        },
                      ]
                }
                ariaLabel={`${selected.name}: ${
                  rpmReading.value == null
                    ? "RPM unknown"
                    : writeQuantity(rpmReading.value)
                }, ${
                  selected.rpmLimit === null
                    ? "cap unknown"
                    : `cap ${writeQuantity(quantity("rpm", selected.rpmLimit))}`
                }`}
              />
            </Cluster>
          </Section>
        ),
        <Section key="controls" gap="related-dense">
          {/* Relative to the value beside them, so an unread figure disables them. */}
          <Cluster justify="between" wrap>
            <ReadoutCaption>RPM cap</ReadoutCaption>
            <Inline>
              <ActionButton
                tone="ghost"
                type="button"
                aria-label={stepperLabel("Lower RPM cap", selected.rpmLimit)}
                disabled={selected.rpmLimit === null}
                onClick={() =>
                  selected.rpmLimit !== null &&
                  setRpmLimit(selected.partId, selected.rpmLimit - RPM_STEP)
                }
              >
                −
              </ActionButton>
              <Text size="sm" tone="default">
                {selected.rpmLimit === null
                  ? "RPM cap unknown"
                  : Math.round(selected.rpmLimit)}
              </Text>
              <ActionButton
                tone="ghost"
                type="button"
                aria-label={stepperLabel("Raise RPM cap", selected.rpmLimit)}
                disabled={selected.rpmLimit === null}
                onClick={() =>
                  selected.rpmLimit !== null &&
                  setRpmLimit(selected.partId, selected.rpmLimit + RPM_STEP)
                }
              >
                +
              </ActionButton>
            </Inline>
          </Cluster>

          <Cluster justify="between" wrap>
            <ReadoutCaption>Torque</ReadoutCaption>
            <Inline>
              <ActionButton
                tone="ghost"
                type="button"
                aria-label={stepperLabel(
                  "Lower torque limit",
                  selected.torqueLimit,
                )}
                disabled={selected.torqueLimit === null}
                onClick={() =>
                  selected.torqueLimit !== null &&
                  setTorqueLimit(
                    selected.partId,
                    selected.torqueLimit - TORQUE_STEP,
                  )
                }
              >
                −
              </ActionButton>
              <Text size="sm" tone="default">
                {/* A worded absence, since a bare placeholder between two steppers reads as a render failure. */}
                {selected.torqueLimit === null ? (
                  "Torque unknown"
                ) : (
                  <Unit
                    value={roboticsReading[selected.srcIndex].servoMotorLimit}
                    decimals={0}
                  />
                )}
              </Text>
              <ActionButton
                tone="ghost"
                type="button"
                aria-label={stepperLabel(
                  "Raise torque limit",
                  selected.torqueLimit,
                )}
                disabled={selected.torqueLimit === null}
                onClick={() =>
                  selected.torqueLimit !== null &&
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

          <Cluster justify="start" wrap>
            {/* An unread flag gets a third, disabled state rather than defaulting to off or unlocked. */}
            <ToggleButton
              size="sm"
              active={selected.motorEngaged === true}
              tone="go"
              disabled={selected.motorEngaged === null}
              aria-label={flagLabel("Toggle motor", selected.motorEngaged)}
              onClick={() =>
                selected.motorEngaged !== null &&
                setMotor(selected.partId, !selected.motorEngaged)
              }
            >
              Motor{" "}
              {selected.motorEngaged === null
                ? "unknown"
                : selected.motorEngaged
                  ? "on"
                  : "off"}
            </ToggleButton>
            <ToggleButton
              size="sm"
              active={selected.locked === true}
              tone="warn"
              disabled={selected.locked === null}
              aria-label={flagLabel("Toggle lock", selected.locked)}
              onClick={() =>
                selected.locked !== null &&
                setLock(selected.partId, !selected.locked)
              }
            >
              {selected.locked === null
                ? "Lock unknown"
                : selected.locked
                  ? "Locked"
                  : "Unlocked"}
            </ToggleButton>
            {/* The brake sends an absolute percentage inverted from the current one, so an unread brake disables it. */}
            <ToggleButton
              size="sm"
              active={
                selected.brakePercentage !== null &&
                selected.brakePercentage > 0
              }
              tone="warn"
              disabled={selected.brakePercentage === null}
              aria-label={
                selected.brakePercentage === null
                  ? "Toggle brake (unavailable, not reported)"
                  : undefined
              }
              onClick={() =>
                selected.brakePercentage !== null &&
                setBrake(
                  selected.partId,
                  selected.brakePercentage > 0 ? 0 : 100,
                )
              }
            >
              Brake{" "}
              {selected.brakePercentage === null
                ? "unknown"
                : selected.brakePercentage > 0
                  ? "on"
                  : "off"}
            </ToggleButton>
            {/* Reverse stays available on an unread heading; only the heading it prints is withheld. */}
            <ToggleButton size="sm" onClick={() => reverse(selected.partId)}>
              {selected.counterClockwise === null
                ? "Reverse"
                : selected.counterClockwise
                  ? "↺ CCW"
                  : "↻ CW"}
            </ToggleButton>
          </Cluster>
        </Section>,
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
                      value={roboticsReading[r.srcIndex].currentRPM}
                      decimals={0}
                      hideUnitInGroup
                    />
                    /
                    <Unit
                      value={roboticsReading[r.srcIndex].rpmLimit}
                      decimals={0}
                    />
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
