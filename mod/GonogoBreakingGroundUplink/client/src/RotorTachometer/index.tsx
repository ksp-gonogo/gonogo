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

/**
 * One rotor as this widget draws it.
 *
 * Every measured field is `number | null`, and the null carries the weight:
 * `BreakingGroundViewProvider` puts each of them through
 * `SnapshotDict.GetDouble`, which withholds on absent, non-numeric AND
 * non-finite input, and `ServoCapture` nulls every field that does not apply to
 * a servo of this kind. A zero here is a READING: a rotor at 0 RPM is stopped,
 * and a cap of 0 is a rotor commanded to stop. Substituting a zero for absence
 * states something definite about the craft that nobody measured, and the RPM
 * and torque steppers compute their next value from these numbers, so the
 * substitution does not stay on screen: it goes up to the rotor.
 */
export interface RotorInfo {
  /**
   * Position in `robotics.servos` AS DELIVERED, which is not this rotor's
   * position in the parsed list: the parse drops non-rotor servos and any
   * entry without a `partId`, so the two indices diverge on the first mixed
   * craft.
   *
   * It is here so a DISPLAYED figure can be read back as a field reading and
   * arrive at `Unit` with its currency intact. The numeric fields below stay
   * because the steppers compute the next commanded value from them, and a
   * command wants a bare number that `dateReadings` has already withheld when
   * it is not current.
   */
  srcIndex: number;
  partId: string;
  name: string;
  rpm: number | null;
  rpmLimit: number | null;
  torqueLimit: number | null;
  maxTorque: number | null;
  brakePercentage: number | null;
  /**
   * The three flags, `boolean | null` because every one of them is declared
   * nullable on `ServoEntry` and `SnapshotDict.GetBool` withholds rather than
   * defaulting. A `=== true` read collapsed unknown into false, and each false
   * is a definite claim: "Motor off", "Unlocked", and a direction button
   * reading "↻ CW" for a rotor whose heading nobody reported.
   */
  motorEngaged: boolean | null;
  locked: boolean | null;
  counterClockwise: boolean | null;
  output: number | null;
}

/**
 * The value of a FACT: something that stays true until an event changes it, and no
 * event can reach us down a link that is not delivering. `whenConfirmedNothing` is
 * what an `absent` tombstone means here, which is a different answer from `pending`
 * and must not collapse into it.
 */
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
  // Indexed, because `srcIndex` must be the position in the DELIVERED array
  // and the two `continue`s below make that differ from the output position.
  for (const [srcIndex, entry] of raw.entries()) {
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

/**
 * A relative stepper's accessible name, carrying WHY it is disabled when the
 * figure it steps from was never read. A `disabled` attribute on its own is
 * announced as "unavailable" with no reason, and the greying is visual only.
 */
const stepperLabel = (action: string, from: number | null): string =>
  from === null ? `${action} (unavailable, not reported)` : action;

/** The same, for a toggle whose `enabled` is the inverse of an unread flag. */
const flagLabel = (action: string, from: boolean | null): string | undefined =>
  from === null ? `${action} (unavailable, not reported)` : undefined;

/**
 * The same rotors, off a list that has stopped arriving: the two MEASURED
 * figures withheld, every setting kept.
 *
 * <p>`rpm` and `output` are what the machine is doing, and a rotor spins on
 * without telling us, so both are the situation NOW and cannot be dated. Nulling
 * them hands the gauge to the vocabulary already in the file: the needle draws
 * "unknown" rather than pointing somewhere.</p>
 *
 * <p>Everything else STAYS, because none of it is a measurement. `rpmLimit`,
 * `torqueLimit`, `maxTorque` and `brakePercentage` are settings, `motorEngaged`,
 * `locked` and `counterClockwise` are states a command puts the rotor in, and
 * none of them drifts while the link is down. The cap in particular is what the
 * gauge's go-zone arc is drawn from, so withholding it would have blanked the
 * scale around a needle we were withholding anyway.</p>
 */
export function dateReadings(rotors: RotorInfo[]): RotorInfo[] {
  return rotors.map((r) => ({ ...r, rpm: null, output: null }));
}

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
  /* An RPM gauge is read as the situation now, so the NEEDLE is withheld rather
     than held, and nothing could carry it forward anyway: `robotics.servos` is
     never reckonable.

     That argument reaches the needle and stops there. Which rotors the craft
     carries, their caps, torque and brake settings, and whether each is engaged,
     locked or turning counter-clockwise are all things a command set and no
     event can change down a link that is not delivering. They are held exactly
     as `available` and `breakingGround` are just below. See `dateReadings`. */
  const roboticsReading = useTelemetry("robotics.servos");
  const roboticsRaw = stillTrue(roboticsReading, undefined);
  const readingsNotCurrent = roboticsReading.state === "stale";
  // Two DIFFERENT facts, and the empty state needs both. `robotics.available`
  // is "this craft carries a robotic part", a per-vessel reading that rides the
  // delay clock. `game.dlc.breakingGround` is "the install has the expansion",
  // a ground-side fact that is true or false independent of any vessel. See
  // `emptyStateText`.
  const available = stillTrue(
    useTelemetry("robotics.available"),
    undefined,
  )?.available;
  const breakingGround = stillTrue(
    useTelemetry("game.dlc"),
    undefined,
  )?.breakingGround;

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

  const rotors = readingsNotCurrent
    ? dateReadings(parseRotors(roboticsRaw))
    : parseRotors(roboticsRaw);
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
    // Both steppers dispatch NOTHING while the cap is unread. They are
    // relative: `cap + 10` off a substituted zero sends `setRpmLimit value=10`
    // to a rotor really capped at 300, so one press of a mapped button
    // collapses the real limit and the operator sees only their own nudge.
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
    // Motor and lock send an ABSOLUTE `enabled`, chosen by inverting the state
    // read back, so an unread flag would command the inverse of a guess.
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
      // `reverse` carries no value, so it stays available on an unread
      // heading: it flips whatever the rotor is doing. What it must NOT do is
      // report the heading back, because `counterClockwise === true` made an
      // unread rotor answer "CW" and a bound device's render style drew that.
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
  // The go-toned "within cap" arc needs a cap to end at. With the cap unread
  // the dial still shows live RPM, it just draws no zones: an arc running to a
  // substituted 1 rpm paints the whole dial as over-cap.
  const cap =
    selected.rpmLimit === null ? null : Math.max(selected.rpmLimit, 1);
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
    <Panel
      panelTitle="ROTORS"
      sections={[
        readingsNotCurrent && (
          <Section key="dated" full>
            {/* Names which half is dated, because "no longer current" over a
                panel still showing caps and brake settings would read as the
                whole instrument being dead. Only the needle is withheld. */}
            <Text tone="warn" size="xs" role="status" aria-live="polite">
              RPM no longer current: the rotors, their caps, torque and brake
              settings are the last reported.
            </Text>
          </Section>
        ),
        showGauge && (
          <Section key="gauge">
            <Cluster justify="center" ref={gaugeRef}>
              {/* No needle without a reading to put it at. A dial parked at 0
                  is a rotor that is stopped, which is a reading the operator
                  acts on, and the aria-label said it out loud too ("0 rpm,
                  cap n rpm"). */}
              {selected.rpm === null ? (
                <Text size="sm" tone="muted" role="status">
                  RPM unknown
                </Text>
              ) : (
                <Gauge
                  value={quantity("rpm", clamp(selected.rpm, 0, ROTOR_MAX_RPM))}
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
                  ariaLabel={`${selected.name}: ${writeQuantity(quantity("rpm", selected.rpm))}, ${
                    selected.rpmLimit === null
                      ? "cap unknown"
                      : `cap ${writeQuantity(quantity("rpm", selected.rpmLimit))}`
                  }`}
                />
              )}
            </Cluster>
          </Section>
        ),
        <Section key="controls" gap="sm">
          {/* Both steppers are RELATIVE to the value beside them, so an unread
              figure disables them rather than stepping off a substituted zero.
              The reason rides the accessible NAME rather than a visual-only
              greying, so a screen reader hears why the control will not act,
              and the readout beside it says the same thing on screen. */}
          <Cluster justify="between" gap="md" wrap>
            <ReadoutCaption>RPM cap</ReadoutCaption>
            <Inline gap="sm">
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

          <Cluster justify="between" gap="md" wrap>
            <ReadoutCaption>Torque</ReadoutCaption>
            <Inline gap="sm">
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
                {/* "Torque unknown" stays a WORDED absence rather than a null
                    token, because this line sits between two steppers and a
                    bare placeholder there reads as a figure that failed to
                    render. The figure itself is a field reading, so when it IS
                    present it carries its own currency. */}
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

          <Cluster justify="start" gap="sm" wrap>
            {/* Motor and lock each send an ABSOLUTE `enabled` chosen by
                inverting the state read back, so an unread flag gets a third,
                disabled rung rather than defaulting to off/unlocked. */}
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
            {/* The brake toggle sends an ABSOLUTE percentage chosen by
                inverting the current one, so an unread brake would read "off"
                and then command 100% to a rotor already fully braked. */}
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
            {/* Reverse carries no value, so it stays available: it flips
                whatever the rotor is doing. Only the HEADING it prints is
                withheld, because "↻ CW" was a definite claim off an unread
                flag. */}
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
          <Section key="rotors" gap="sm" aria-label="Rotors">
            {rotors.map((r) => (
              <SelectableRow
                key={r.partId}
                selected={r.partId === selected.partId}
                onClick={() => setSelectedId(r.partId)}
              >
                <span>{r.name}</span>
                <span>
                  {/* One scope around the pair, so the two halves cannot land
                      on different rungs, and the symbol is drawn once at the
                      end rather than on both figures in a row this dense.

                      Both figures are read as FIELD READINGS off the delivered
                      servo, so each arrives carrying its own currency and
                      `Unit` draws its own null state. The parsed numbers beside
                      them are what the steppers command from, and those stay
                      numbers. */}
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
