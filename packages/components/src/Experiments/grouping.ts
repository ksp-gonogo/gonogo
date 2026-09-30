import type { Contributed } from "@ksp-gonogo/core";
import type { ContributedInstrument, Instrument } from "./instrument";

export interface InstrumentGroup<Item extends Instrument = Instrument> {
  expId: string;
  items: Item[];
}

export function groupByExpId<Item extends Instrument>(
  instruments: Item[],
): InstrumentGroup<Item>[] {
  const map = new Map<string, Item[]>();
  for (const inst of instruments) {
    const list = map.get(inst.expId);
    if (list) list.push(inst);
    else map.set(inst.expId, [inst]);
  }
  return Array.from(map.entries()).map(([expId, items]) => ({ expId, items }));
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
  groups: InstrumentGroup<Contributed<ContributedInstrument>>[];
}

/**
 * Contributed instruments by supplier, then by experiment, in first-seen order so
 * sections do not reshuffle. An ownerless contribution is labelled by its id.
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
    groups: groupByExpId(items),
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
