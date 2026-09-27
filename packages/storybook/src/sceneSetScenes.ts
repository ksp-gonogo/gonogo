import "../../../mod/GonogoBreakingGroundUplink/client/src/index.ts";
import servos from "../../../mod/GonogoBreakingGroundUplink/client/src/RoboticsConsole/__fixtures__/servos.json";
import rotors from "../../../mod/GonogoBreakingGroundUplink/client/src/RotorTachometer/__fixtures__/rotors.json";
import valentina from "../../components/src/CrewStatus/__fixtures__/valentina-solo-orbit.json";
import heavyLifter from "../../components/src/Twr/__fixtures__/heavy-lifter-warn.json";
import standardLaunch from "../../components/src/Twr/__fixtures__/standard-launch-ok.json";
import type { SceneEntry } from "./SceneSet";

/** A fixture's `robotics.servos` stream payload, with one servo's fields replaced. */
function servosWith(
  fixture: { _stream: { emits: { topic: string; payload: unknown }[] } },
  partId: string,
  change: Record<string, unknown>,
) {
  const emit = fixture._stream.emits.find((e) => e.topic === "robotics.servos");
  const list = (emit?.payload ?? []) as { partId: string }[];
  return list.map((servo) =>
    servo.partId === partId ? { ...servo, ...change } : servo,
  );
}

const propulsion = (currentThrust: number) => ({
  totalMass: 10,
  dryMass: 6,
  currentThrust,
  availableThrust: currentThrust,
});

/** Two scenes of one widget, a second widget, and two Uplink widgets, all on one page. */
export const SCENES: readonly SceneEntry[] = [
  {
    kind: "widget",
    label: "twr standard-launch-ok",
    widgetId: "twr",
    fixture: standardLaunch,
    w: 4,
    h: 5,
    feed: { channel: "vessel.propulsion", value: propulsion(300) },
  },
  {
    kind: "widget",
    label: "twr heavy-lifter-warn",
    widgetId: "twr",
    fixture: heavyLifter,
    w: 4,
    h: 5,
    feed: { channel: "vessel.propulsion", value: propulsion(60) },
  },
  {
    kind: "widget",
    label: "crew-status valentina-solo-orbit",
    widgetId: "crew-status",
    fixture: valentina,
    w: 6,
    h: 8,
    feed: {
      channel: "vessel.crew",
      value: {
        count: 1,
        capacity: 1,
        crew: [{ name: "Bill Kerman", trait: "Engineer" }],
      },
    },
  },
  {
    kind: "uplink",
    label: "rotor-tachometer rotors",
    uplinkId: "breakingGround",
    fixture: rotors,
    file: "mod/GonogoBreakingGroundUplink/client/src/RotorTachometer/__fixtures__/rotors.json",
    feed: {
      topic: "robotics.servos",
      payload: servosWith(rotors, "101", { currentRPM: 120 }),
    },
  },
  {
    kind: "uplink",
    label: "robotics-console servos",
    uplinkId: "breakingGround",
    fixture: servos,
    file: "mod/GonogoBreakingGroundUplink/client/src/RoboticsConsole/__fixtures__/servos.json",
    feed: {
      topic: "robotics.servos",
      payload: servosWith(servos, "11", { currentAngle: 45 }),
    },
  },
];
