import {
  type CatalogContact,
  DeployedOffReason,
  DeployedPowerState,
  type TrackingStationCatalog,
  VesselType,
} from "@ksp-gonogo/sitrep-sdk";
import { boolOrNull, numOrNull } from "../wire";

/**
 * One deployed experiment as the widget draws it.
 * Every figure is `null` when the mod withheld it, since 0% is a real reading, and `collecting` is `null` whenever the completion it derives from is.
 */
export interface DeployedExperiment {
  partId: number;
  id: string;
  name: string;
  total: number | null;
  limit: number | null;
  progress: number | null;
  /** Data the experiment holds that has not been sent home, in Mits. `null` is unread, and 0 is a real empty store. */
  backlog: number | null;
  /** Whether the experiment finished with data still stored, which stays until a kerbal retrieves it. `null` is unread. */
  stranded: boolean | null;
  transmitted: number | null;
  collecting: boolean | null;
  /** Whether the experiment is switched on. `null` is unread, which is not off. */
  enabled: boolean | null;
  /** Why it is off where the game says; `unknown` is off with no automatic cause. `null` while on or unread. */
  offReason: ExperimentOffReason | null;
}

export type ExperimentOffReason = "completed" | "invalid-situation" | "unknown";

/** One station's report as the widget draws it, off `deployed.station.<controllerVesselId>.report`. */
export interface DeployedStation {
  /** The controller vessel's id, the key of the station's topic. */
  id: string;
  /** The controller vessel's name, `null` when the mod withheld it. */
  name: string | null;
  /** Where the station sits, `null` when the mod withheld it. */
  body: string | null;
  biome: string | null;
  /** KSP's situation name for the controller (`LANDED`, `SPLASHED`), `null` when withheld. */
  situation: string | null;
  /** `null` when the mod declined to state the cluster's power state, which is a third answer and not "unpowered". */
  powered: boolean | null;
  /** Breaking Ground's own integral power units, not electric charge; a live cluster with dark panels reports 0. */
  powerAvailable: number | null;
  powerRequired: number | null;
  /** Whether the game would let the station's science be sent home now. `null` is unread, which is not a refusal. */
  sendPathHome: boolean | null;
  /** Whether the cluster's last attempt to send failed. `null` is unread. */
  dataSendFailed: boolean | null;
  experiments: DeployedExperiment[];
}

/** One station the roster names: a controller vessel, and what its command centre knows of the contact. */
export interface StationListing {
  vesselId: string;
  name: string;
  contact: CatalogContact | null;
  /** The universal time the centre last had a link to the station, `null` when it knows of none. */
  lastContactUt: number | null;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const clamp01OrNull = (v: number | null) => (v === null ? null : clamp01(v));
const stringOrNull = (v: unknown) => (typeof v === "string" ? v : null);

/** Branch on the mod's derived ordinal, never on prose; an unstated state is unknown, not unpowered. */
function poweredFromState(power: unknown): boolean | null {
  if (typeof power !== "number") return null;
  return (power as DeployedPowerState) === DeployedPowerState.Powered;
}

/** Branch on the mod's ordinal; a reason the client does not know reads as unknown, never as a cause. */
function offReasonFrom(
  enabled: boolean | null,
  reason: unknown,
): ExperimentOffReason | null {
  if (enabled !== false || typeof reason !== "number") return null;
  switch (reason as DeployedOffReason) {
    case DeployedOffReason.Completed:
      return "completed";
    case DeployedOffReason.InvalidSituation:
      return "invalid-situation";
    default:
      return "unknown";
  }
}

function experimentFrom(
  raw: unknown,
  index: number,
  stationId: string,
): DeployedExperiment | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const e = raw as Record<string, unknown>;
  const completed = numOrNull(e.scienceCompletedPercentage);
  const transmittedPercent = numOrNull(e.scienceTransmittedPercentage);
  const value = numOrNull(e.scienceValue);
  // Every derivation carries the absence: a withheld completion yields no progress and no `collecting` verdict.
  const progress = clamp01OrNull(completed === null ? null : completed / 100);
  const transmittedShare = clamp01OrNull(
    transmittedPercent === null ? null : transmittedPercent / 100,
  );
  const enabled = boolOrNull(e.enabled);
  const experimentId = stringOrNull(e.experimentId);
  const partName = stringOrNull(e.partName);
  return {
    partId: index,
    id: experimentId ?? `${stationId}-${index}`,
    name: partName || experimentId || "Experiment",
    total: value,
    limit: numOrNull(e.scienceLimit),
    progress,
    backlog: numOrNull(e.storedData),
    stranded: boolOrNull(e.stranded),
    transmitted:
      value === null || transmittedShare === null
        ? null
        : value * transmittedShare,
    // An experiment that is switched off is not collecting, however far it has got.
    collecting:
      completed === null ? null : completed < 100 && enabled !== false,
    enabled,
    offReason: offReasonFrom(enabled, e.offReason),
  };
}

/**
 * Parses one station's report. Returns null when the payload could not be read,
 * so a station with nothing heard stays distinct from one reporting no
 * experiments. `partId` is a synthesised index, used only as a key.
 */
export function parseStation(id: string, raw: unknown): DeployedStation | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const s = raw as Record<string, unknown>;
  const experiments = (Array.isArray(s.experiments) ? s.experiments : [])
    .map((entry, index) => experimentFrom(entry, index, id))
    .filter((e): e is DeployedExperiment => e !== null);
  return {
    id,
    name: stringOrNull(s.stationName),
    body: stringOrNull(s.body),
    biome: stringOrNull(s.biome),
    situation: stringOrNull(s.situation),
    powered: poweredFromState(s.power),
    powerAvailable: numOrNull(s.powerAvailable),
    powerRequired: numOrNull(s.powerRequired),
    sendPathHome: boolOrNull(s.sendPathHome),
    dataSendFailed: boolOrNull(s.dataSendFailed),
    experiments,
  };
}

/**
 * Every deployed-science station the catalog lists, by name. A station is the
 * controller vessel of a cluster, the one vessel Breaking Ground gives a
 * CommNet link, so it is the one whose contact the centre knows. Returns null
 * when the catalog could not be read, so "no stations" stays a claim only a
 * real catalog makes.
 */
export function stationsFromCatalog(
  catalog: TrackingStationCatalog | null | undefined,
): StationListing[] | null {
  if (!catalog || !Array.isArray(catalog.entries)) return null;
  return catalog.entries
    .filter(
      (entry) => entry.vesselType === VesselType.DeployedScienceController,
    )
    .map((entry) => ({
      vesselId: entry.vesselId,
      name: entry.name,
      contact: entry.contact ?? null,
      lastContactUt: numOrNull(entry.lastContactUt),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
