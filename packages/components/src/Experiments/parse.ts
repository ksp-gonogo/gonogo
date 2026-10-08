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

/**
 * Parses `science.instruments`. The wire's `partName`, `experimentId` and
 * `dataIsCollectable` become the widget's `partTitle`, `expId` and `hasData`;
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
      hasData: e.dataIsCollectable === true,
      rerunnable: e.rerunnable === true,
      inoperable: e.inoperable === true,
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
  partName: string;
  dataStored: number | null;
  dataStorage: number | null;
  storedScience: number | null;
  /** Null when the provider could not read it; not the same as idle. */
  processingData: boolean | null;
  statusText: string | null;
  scientistCount: number | null;
  scienceRate: number | null;
  /** Null when the provider could not read it; OFFLINE is a diagnosis, not a failed read. */
  isOperational: boolean | null;
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
      partName: typeof e.partName === "string" ? e.partName : "Lab",
      dataStored: magnitudeOf(asQuantityish(e.dataStored)),
      dataStorage: magnitudeOf(asQuantityish(e.dataStorage)),
      storedScience: magnitudeOf(asQuantityish(e.storedScience)),
      processingData: asFlag(e.processingData),
      statusText: typeof e.statusText === "string" ? e.statusText : null,
      scientistCount: magnitudeOf(asQuantityish(e.scientistCount)),
      scienceRate: magnitudeOf(asQuantityish(e.scienceRate)),
      isOperational: asFlag(e.isOperational),
    });
  }
  return out;
}
