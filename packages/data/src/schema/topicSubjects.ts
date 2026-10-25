import { getRuntimeRegisteredTopicIds } from "@ksp-gonogo/sitrep-sdk";
import { humaniseFieldPath, type TopicFieldKey } from "./topicFieldCatalog";

interface Subject {
  /** What the Topic describes, in the game's own nouns. */
  name: string;
  /** Offered before any search is typed. */
  common?: true;
  /** Field phrasing where the split of the field name reads ambiguously. */
  fields?: Readonly<Record<string, string>>;
}

const SUBJECTS: Readonly<Record<string, Subject>> = {
  "vessel.flight": {
    name: "Active vessel",
    common: true,
    fields: {
      altitudeAsl: "Altitude (sea level)",
      altitudeTerrain: "Altitude (above terrain)",
      dynamicPressureKPa: "Dynamic pressure",
      gForce: "G-force",
      mach: "Mach number",
    },
  },
  "vessel.orbit": {
    name: "Active vessel orbit",
    common: true,
    fields: {
      sma: "Semi-major axis",
      ecc: "Eccentricity",
      inc: "Inclination",
      argPe: "Argument of periapsis",
      lan: "Longitude of ascending node",
    },
  },
  "vessel.propulsion": { name: "Active vessel propulsion", common: true },
  "vessel.resources": { name: "Active vessel resources", common: true },
  "vessel.orbit.truth": { name: "Active vessel orbit (true)" },
  "vessel.attitude": { name: "Active vessel attitude" },
  "vessel.surface": { name: "Active vessel surface" },
  "vessel.thermal": { name: "Active vessel heat" },
  "vessel.landing": { name: "Active vessel landing" },
  "vessel.maneuver": { name: "Active vessel maneuver" },
  "vessel.target": { name: "Active vessel target" },
  "vessel.dock": { name: "Active vessel docking" },
  "vessel.structure": { name: "Active vessel structure" },
  "vessel.comms": { name: "Active vessel antenna" },
  "vessel.control": { name: "Active vessel controls" },
  "vessel.light": { name: "Active vessel light" },
  "vessel.crew": { name: "Active vessel crew" },
  "vessel.identity": { name: "Active vessel identity" },
  "vessel.physics.mode": { name: "Active vessel physics" },
  "crash.lastCrash": {
    name: "Last crash",
    fields: { altitude: "Altitude at impact" },
  },
  "dv.summary": { name: "Delta-v" },
  "dv.stages": { name: "Delta-v by stage" },
  "parts.power": { name: "Electric power" },
  "time.warp": { name: "Time warp" },
  "time.calendar": { name: "Game clock" },
  "comms.signal": { name: "Signal" },
  "comms.delay": { name: "Signal delay" },
  "comms.link": { name: "Comms link" },
  "comms.connectivity": { name: "Comms connectivity" },
  "comms.nextLoss": { name: "Next signal loss" },
  "comms.occlusion": { name: "Signal occlusion" },
  "comms.journey": { name: "Comms journey" },
  "comms.control": { name: "Comms control" },
  "comms.contacts": { name: "Comms contacts" },
  "comms.degrade": { name: "Comms degradation" },
  "comms.commandCentre": { name: "Command centre comms" },
  "commandCentre.roster": { name: "Command centres" },
  "commandCentre.unreachable": { name: "Unreachable command centres" },
  "flight.current": { name: "Current flight" },
  "flight.ended": { name: "Ended flight" },
  "flight.started": { name: "Started flight" },
  "flight.vesselChanged": { name: "Vessel change" },
  "eva.crew": { name: "Crew on EVA" },
  "science.lab": { name: "Science lab" },
  "science.sensors": { name: "Science sensors" },
  "science.instruments": { name: "Science instruments" },
  "science.experiments": { name: "Science experiments" },
  "science.experimentBreakdown": { name: "Science experiment breakdown" },
  "science.transmissions": { name: "Science transmissions" },
  "science.archive": { name: "Science archive" },
  "isru.converters": { name: "Converters" },
  "isru.drills": { name: "Drills" },
  "robotics.servos": { name: "Servos" },
  "robotics.available": { name: "Robotics" },
  "recovery.lastSummary": { name: "Last recovery" },
  "recovery.hasRecent": { name: "Recent recovery" },
  "crash.hasRecent": { name: "Recent crash" },
  "career.mode": { name: "Career mode" },
  "missions.active": { name: "Active missions" },
  "surface.sites": { name: "Surface sites" },
  "spaceCenter.astronautComplex": { name: "Astronaut complex" },
  "spaceCenter.crewRoster": { name: "Crew roster" },
  "spaceCenter.launchSites": { name: "Launch sites" },
  "spaceCenter.partsAvailable": { name: "Parts available" },
  "spaceCenter.pois": { name: "Points of interest" },
  "spaceCenter.savedShips": { name: "Saved ships" },
  "spaceCenter.scene": { name: "Space centre scene" },
  "alarm.activeList": { name: "Alarms" },
  "alarm.game.list": { name: "Game alarms" },
  "alarm.scet.fired": { name: "Fired alarm" },
  "alarm.scet.topics": { name: "Alarm topics" },
  "game.dlc": { name: "Game DLC" },
  "ksp.revertAvailability": { name: "Revert" },
  "system.frame": { name: "System frame" },
};

export interface SeriesChoice {
  /** The heading the field is listed under. */
  group: string;
  /** The field as the list shows it under its heading. */
  label: string;
  /** The subject and field together, which is what reads unambiguously once picked. */
  summary: string;
  /** Offered before any search is typed. */
  common: boolean;
}

/** "acme.reactor" becomes "Acme". */
function uplinkName(topic: string): string {
  return humaniseFieldPath(topic.split(".")[0]);
}

/**
 * The picker wording for one catalogue field: a core Topic is listed under what
 * it describes, an Uplink's Topic under that Uplink's own name.
 *
 * The contract carries no display name for a Topic or a field, so the subjects
 * and the few field phrasings that need more than the field name split live in
 * this file.
 */
export function seriesChoice(
  entry: TopicFieldKey,
  uplinkTopics: ReadonlySet<string> = new Set(getRuntimeRegisteredTopicIds()),
): SeriesChoice {
  const subject = SUBJECTS[entry.topic];
  if (subject === undefined && uplinkTopics.has(entry.topic)) {
    const rest = entry.topic.split(".").slice(1).join(".");
    const field = humaniseFieldPath(entry.fieldPath);
    const label = rest === "" ? field : `${humaniseFieldPath(rest)} › ${field}`;
    const group = uplinkName(entry.topic);
    return { group, label, summary: `${group} › ${label}`, common: false };
  }
  const group = subject?.name ?? humaniseFieldPath(entry.topic);
  const label =
    subject?.fields?.[entry.fieldPath] ?? humaniseFieldPath(entry.fieldPath);
  return {
    group,
    label,
    summary: `${group} › ${label}`,
    common: subject?.common === true,
  };
}
