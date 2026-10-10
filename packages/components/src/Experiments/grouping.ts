import type { Contributed } from "@ksp-gonogo/core";
import type {
  ContributedInstrument,
  Instrument,
  TitledInstrument,
} from "./instrument";

/**
 * Instruments in one list, ordered by experiment so the cards for one kind of
 * experiment sit together. The sort is stable: instruments of one experiment
 * keep the order the vessel reported them in.
 */
export function byExperiment<Item extends TitledInstrument>(
  instruments: readonly Item[],
): Item[] {
  const name = (inst: TitledInstrument) => inst.expTitle || inst.expId;
  return [...instruments].sort((a, b) => {
    const [left, right] = [name(a), name(b)];
    // An instrument that names no experiment follows every named one.
    if (left === "" || right === "")
      return left === right ? 0 : left === "" ? 1 : -1;
    return left.localeCompare(right);
  });
}

/**
 * The contributed entries this widget draws: first per `partId` wins, and a
 * `partId` the stock list carries is dropped, since the stock row can be commanded.
 */
export function ownContributed(
  entries: readonly Contributed<ContributedInstrument>[],
  stock: Instrument[] | null,
): Contributed<ContributedInstrument>[] {
  const seen = new Set((stock ?? []).map((inst) => inst.partId));
  const out: Contributed<ContributedInstrument>[] = [];
  for (const entry of entries) {
    if (seen.has(entry.partId)) continue;
    seen.add(entry.partId);
    out.push(entry);
  }
  return out;
}

export interface ContributedInstrumentGroup {
  /** Who supplied these, for the section heading. */
  ownerLabel: string;
  items: Contributed<ContributedInstrument>[];
}

/**
 * Contributed instruments by supplier, in first-seen order so sections do not
 * reshuffle. An ownerless contribution is labelled by its id.
 */
export function groupContributed(
  entries: readonly Contributed<ContributedInstrument>[],
): ContributedInstrumentGroup[] {
  const byOwner = new Map<string, Contributed<ContributedInstrument>[]>();
  for (const entry of entries) {
    const label = entry.owner?.name ?? entry.contributionId;
    const list = byOwner.get(label);
    if (list) list.push(entry);
    else byOwner.set(label, [entry]);
  }
  return Array.from(byOwner.entries()).map(([ownerLabel, items]) => ({
    ownerLabel,
    items: byExperiment(items),
  }));
}

export function summarise(instruments: Instrument[]): {
  total: number;
  hasData: number;
  deployed: number;
  inoperable: number;
} {
  let hasData = 0;
  let deployed = 0;
  let inoperable = 0;
  for (const inst of instruments) {
    if (inst.hasData) hasData++;
    if (inst.deployed) deployed++;
    if (inst.inoperable) inoperable++;
  }
  return { total: instruments.length, hasData, deployed, inoperable };
}
