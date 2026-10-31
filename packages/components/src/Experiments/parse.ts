import { isValue, type Value, value } from "@ksp-gonogo/sitrep-sdk";
import { asQuantityish, magnitudeOf } from "../shared/magnitude";
import type { TitledInstrument } from "./instrument";

/** Confirmed-none values for the science reads: present, and empty. */
export const EMPTY_INSTRUMENTS = { instruments: [] as unknown[] };
export const EMPTY_EXPERIMENTS = { experiments: [] as unknown[] };

function partIdOf(raw: unknown): string | null {
  if (typeof raw === "string") return raw;
  if (typeof raw === "number") return String(raw);
  return null;
}

/** A wire bool with its absence kept as undefined. */
function asOptionalFlag(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

/** A wire quantity as a value, with a plain number taken as science; undefined for anything else. */
function scienceValue(raw: unknown): Value<"science"> | undefined {
  if (isValue(raw)) return raw as Value<"science">;
  return typeof raw === "number" && Number.isFinite(raw)
    ? value("science", raw)
    : undefined;
}

/** The banked share of the subject's cap, held to 0 to 1, or undefined where either figure is absent or the cap is not positive. */
function collectedShare(
  science: unknown,
  cap: unknown,
): Value<"ratio"> | undefined {
  const banked = scienceValue(science);
  const ceiling = scienceValue(cap);
  if (!banked || !ceiling?.greaterThan(0)) return undefined;
  const share = banked.per(ceiling).in("ratio") as Value<"ratio">;
  if (share.greaterThan(1)) return value("ratio", 1);
  return share.lessThan(0) ? value("ratio", 0) : share;
}

/**
 * Parses `science.instruments`. The wire's `partName`, `experimentId` and
 * `holdsData` become the widget's `partTitle`, `expId` and `hasData`;
 * `partId` normalises to a string.
 */
export function parseInstruments(raw: unknown): TitledInstrument[] | null {
  if (raw === null || raw === undefined) return null;
  if (!Array.isArray(raw)) return null;
  const out: TitledInstrument[] = [];
  const entries: unknown[] = raw;
  for (const entry of entries) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const e = entry as Record<string, unknown>;
    const partId = partIdOf(e.partId);
    if (partId === null) continue;
    out.push({
      partId,
      partTitle: typeof e.partName === "string" ? e.partName : "Unknown part",
      expId: typeof e.experimentId === "string" ? e.experimentId : "",
      expTitle: typeof e.title === "string" && e.title ? e.title : undefined,
      deployed: e.deployed === true,
      evaCollectable: asOptionalFlag(e.dataIsCollectable),
      hasData: e.holdsData === true,
      dataKnown: typeof e.holdsData === "boolean",
      rerunnable: e.rerunnable === true,
      rerunnableKnown: typeof e.rerunnable === "boolean",
      inoperable: e.inoperable === true,
      resettable: typeof e.resettable === "boolean" ? e.resettable : null,
      collected: collectedShare(e.science, e.scienceCap),
      continuous: asOptionalFlag(e.continuous),
      running: asOptionalFlag(e.running),
      producing: asOptionalFlag(e.producing),
      runIssue:
        typeof e.runIssue === "string" && e.runIssue ? e.runIssue : undefined,
    });
  }
  return out;
}

// The wire carries no vessel-wide data total, so it is summed here.
export function sumExperimentDataAmount(raw: unknown): number {
  if (!Array.isArray(raw)) return 0;
  let total = 0;
  const entries: unknown[] = raw;
  for (const entry of entries) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const dataAmount = magnitudeOf(
      asQuantityish((entry as Record<string, unknown>).dataAmount),
    );
    if (dataAmount !== null) {
      total += dataAmount;
    }
  }
  return total;
}

export interface LabStatus {
  /** The lab part's flight id, which the lab Start and Stop commands take; `null` where the wire carried none. */
  partId: string | null;
  partName: string;
  dataStored: number | null;
  dataStorage: number | null;
  storedScience: number | null;
  /** Null when the provider could not read it; not the same as idle. */
  processingData: boolean | null;
  statusText: string | null;
  scientistCount: number | null;
  scienceRate: number | null;
  /** The value model its rate and data figures are in; `null` when the provider did not tag the lab. */
  valueModel: string | null;
  /** Null when the provider could not read it; offline is a diagnosis, not a failed read. */
  isOperational: boolean | null;
  /** Whether the lab's research is switched on; `null` where the provider could not read it. */
  running: boolean | null;
  /** Whether the lab is turning data into science now; `null` where the provider could not read it. */
  producing: boolean | null;
  /** Why a switched-on lab is not producing, as written by the provider. Display text only. */
  runIssue: string | null;
}

/** A wire bool with its absence kept as null. */
function asFlag(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

/**
 * Parses `science.lab`, one entry per lab part. A lab with everything at zero is
 * idle, not absent.
 */
export function parseLab(raw: unknown): LabStatus[] | null {
  if (raw === null || raw === undefined) return null;
  if (!Array.isArray(raw)) return null;
  const out: LabStatus[] = [];
  const entries: unknown[] = raw;
  for (const entry of entries) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const e = entry as Record<string, unknown>;
    out.push({
      partId: partIdOf(e.partId),
      partName: typeof e.partName === "string" ? e.partName : "Lab",
      dataStored: magnitudeOf(asQuantityish(e.dataStored)),
      dataStorage: magnitudeOf(asQuantityish(e.dataStorage)),
      storedScience: magnitudeOf(asQuantityish(e.storedScience)),
      processingData: asFlag(e.processingData),
      statusText: typeof e.statusText === "string" ? e.statusText : null,
      scientistCount: magnitudeOf(asQuantityish(e.scientistCount)),
      scienceRate: magnitudeOf(asQuantityish(e.scienceRate)),
      valueModel:
        typeof e.valueModel === "string" && e.valueModel ? e.valueModel : null,
      isOperational: asFlag(e.isOperational),
      running: asFlag(e.running),
      producing: asFlag(e.producing),
      runIssue:
        typeof e.runIssue === "string" && e.runIssue ? e.runIssue : null,
    });
  }
  return out;
}
