import { DeployedPowerState } from "@ksp-gonogo/sitrep-sdk";
import { numOrNull } from "../wire";

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
  stored: number | null;
  transmitted: number | null;
  collecting: boolean | null;
}

export interface DeployedBase {
  id: number;
  body: string;
  /** `null` when the mod declined to state the cluster's power state, which is a third answer and not "unpowered". */
  powered: boolean | null;
  /** Breaking Ground's own integral power units, not electric charge; a live cluster with dark panels reports 0. */
  powerAvailable: number | null;
  powerRequired: number | null;
  controllerEnabled: boolean;
  experimentCount: number;
  experiments: DeployedExperiment[];
}

/** One entry off the `deployed.bases` wire: one deployed experiment, grouped into its base by `vesselName`. */
interface FlatDeployedEntry {
  vesselName: string;
  partName: string | null;
  body: string | null;
  experimentId: string | null;
  /** The four science figures, `null` when the mod withheld one; a freshly planted experiment reports 0%. */
  scienceCompletedPercentage: number | null;
  scienceTransmittedPercentage: number | null;
  scienceValue: number | null;
  scienceLimit: number | null;
  /** Localised prose, display only. {@link power} is the field to branch on. */
  powerState: string | null;
  /** Localised prose, display only. See {@link controllerConnected}. */
  connectionState: string | null;
  /** The mod's derived power state; `null` is a third answer, not "unpowered". */
  power: DeployedPowerState | null;
  /** The mod's derived controller-attachment fact. */
  controllerConnected: boolean | null;
  /** The cluster's power balance in Breaking Ground's own power units; see {@link DeployedBase.powerAvailable}. */
  powerAvailable: number | null;
  powerRequired: number | null;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const clamp01OrNull = (v: number | null) => (v === null ? null : clamp01(v));

function parseFlatDeployedEntry(entry: unknown): FlatDeployedEntry | null {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  const e = entry as Record<string, unknown>;
  if (typeof e.vesselName !== "string" || !e.vesselName) return null;
  return {
    vesselName: e.vesselName,
    partName: typeof e.partName === "string" ? e.partName : null,
    body: typeof e.body === "string" ? e.body : null,
    experimentId: typeof e.experimentId === "string" ? e.experimentId : null,
    scienceCompletedPercentage: numOrNull(e.scienceCompletedPercentage),
    scienceTransmittedPercentage: numOrNull(e.scienceTransmittedPercentage),
    scienceValue: numOrNull(e.scienceValue),
    scienceLimit: numOrNull(e.scienceLimit),
    powerState: typeof e.powerState === "string" ? e.powerState : null,
    connectionState:
      typeof e.connectionState === "string" ? e.connectionState : null,
    power: typeof e.power === "number" ? (e.power as DeployedPowerState) : null,
    controllerConnected:
      typeof e.controllerConnected === "boolean" ? e.controllerConnected : null,
    powerAvailable: numOrNull(e.powerAvailable),
    powerRequired: numOrNull(e.powerRequired),
  };
}

/** Branch on the mod's derived ordinal, never on the localised `powerState` prose; an unstated state is unknown, not unpowered. */
function poweredFromState(
  power: DeployedPowerState | null | undefined,
): boolean | null {
  if (power === null || power === undefined) return null;
  return power === DeployedPowerState.Powered;
}

function experimentFrom(
  e: FlatDeployedEntry,
  index: number,
  vesselName: string,
): DeployedExperiment {
  // Every derivation carries the absence: a withheld completion yields no progress and no `collecting` verdict.
  const progress = clamp01OrNull(
    e.scienceCompletedPercentage === null
      ? null
      : e.scienceCompletedPercentage / 100,
  );
  const transmittedShare = clamp01OrNull(
    e.scienceTransmittedPercentage === null
      ? null
      : e.scienceTransmittedPercentage / 100,
  );
  const transmitted =
    e.scienceValue === null || transmittedShare === null
      ? null
      : e.scienceValue * transmittedShare;
  return {
    partId: index,
    id: e.experimentId ?? `${vesselName}-${index}`,
    name: e.partName || e.experimentId || "Experiment",
    total: e.scienceValue,
    limit: e.scienceLimit,
    progress,
    stored:
      e.scienceValue === null || transmitted === null
        ? null
        : Math.max(0, e.scienceValue - transmitted),
    transmitted,
    collecting:
      e.scienceCompletedPercentage === null
        ? null
        : e.scienceCompletedPercentage < 100,
  };
}

/**
 * Parses `deployed.bases` into one `DeployedBase` per `vesselName`, since a
 * Breaking Ground cluster is its own vessel. Returns null when the payload
 * could not be read, so "no bases deployed" stays a claim only a real empty
 * list makes. `id` and `partId` are synthesised indices, used only as keys.
 */
export function parseBases(raw: unknown): DeployedBase[] | null {
  if (!Array.isArray(raw)) return null;
  const entries: unknown[] = raw;
  const order: string[] = [];
  const groups = new Map<string, FlatDeployedEntry[]>();
  for (const rawEntry of entries) {
    const entry = parseFlatDeployedEntry(rawEntry);
    if (!entry) continue;
    let list = groups.get(entry.vesselName);
    if (!list) {
      list = [];
      groups.set(entry.vesselName, list);
      order.push(entry.vesselName);
    }
    list.push(entry);
  }

  return order.map((vesselName, baseIndex) => {
    const group = groups.get(vesselName) ?? [];
    const first = group[0];
    const experiments = group.map((e, i) => experimentFrom(e, i, vesselName));
    return {
      id: baseIndex,
      body: first?.body ?? "",
      powered: poweredFromState(first?.power),
      powerAvailable: first?.powerAvailable ?? null,
      powerRequired: first?.powerRequired ?? null,
      // The derived boolean, never the localised `connectionState` prose.
      controllerEnabled: first?.controllerConnected ?? false,
      experimentCount: experiments.length,
      experiments,
    };
  });
}
