import { useContext, useEffect, useMemo, useRef, useState } from "react";
import type {
  ChannelGate,
  CommandGateReport,
  GateVerdict,
  MissingUnlock,
} from "../__generated__/contract";
import { GateOutcome, UnlockKind } from "../__generated__/contract";
import { CommandErrorCode } from "../__generated__/error-codes";
import {
  useTelemetryClientOptional,
  useTelemetryStoreOptional,
} from "./context";
import {
  type Capability,
  LockScopeContext,
  type LockScopeRegistry,
} from "./lock-scope";
import { subscribeTopicRead } from "./subscribe-read";
import { useLatestValue } from "./use-stream";

/**
 * Why a capability is locked: the unlocks it is missing, and a sentence from
 * the mod saying why, for when it named none. Useful for telling the operator
 * what the save has not unlocked yet. Used by the ui-kit's lock scope, which
 * shows one lock message for a group of controls.
 *
 * @category Readings
 */
export interface CapabilityLock {
  /** The Topic or command that is locked. */
  capability: Capability;
  /** What has to be unlocked first. */
  missing: readonly MissingUnlock[];
  /** A sentence saying why, when the mod gave one. */
  detail?: string;
}

/**
 * Only `notUnlocked` locks a scope. A full crew roster, an occupied pad or a
 * short balance refuse one control and may clear in a minute; a capability the
 * save has not bought yet takes away everything built on it.
 */
function lockedVerdict(verdict: GateVerdict | undefined): boolean {
  return (
    verdict?.outcome === GateOutcome.Fail &&
    verdict.errorCode === CommandErrorCode.NotUnlocked
  );
}

/** The longest channel entry covering `topic`, matched the way Uplink ownership is. */
function channelVerdict(
  report: CommandGateReport,
  topic: string,
): GateVerdict | undefined {
  let best: ChannelGate | undefined;
  // An older mod publishes no channel half.
  for (const entry of report.channels ?? []) {
    const covers =
      entry.topic === topic ||
      (entry.topic.endsWith(".") && topic.startsWith(entry.topic));
    if (covers && entry.topic.length > (best?.topic.length ?? -1)) best = entry;
  }
  return best?.verdict;
}

/**
 * Returns the lock on one capability, or `undefined` when the report says
 * nothing locks it. Useful for telling the operator that a Topic or command is
 * unavailable until the save unlocks it.
 */
export function capabilityLock(
  report: CommandGateReport | undefined,
  capability: Capability,
): CapabilityLock | undefined {
  if (!report) return undefined;
  const verdict =
    capability.kind === "command"
      ? report.gates.find((gate) => gate.command === capability.id)?.verdict
      : channelVerdict(report, capability.id);
  if (!verdict || !lockedVerdict(verdict)) return undefined;
  return {
    capability,
    missing: verdict.missing ?? [],
    detail: verdict.detail || undefined,
  };
}

/**
 * Writes one quantity for a lock sentence: a value off the wire, or a plain
 * number a caller supplied, in the unit the field declares. Useful for writing
 * the cost of an unlock in the operator's units. Taken by `lockSentence`.
 */
export type LockQuantityWriter = (
  quantity: { magnitude: number; unit: string } | number,
  unit: string,
) => string;

/**
 * The sentence a locked scope draws. A missing tech node reads "Missing tech:
 * <node>" over what it costs to research; a building reads as its own name over
 * the level it needs, so the two kinds of unlock never read alike. Quantities
 * are written by `write`, so the kit's own unit formatting draws them. Useful
 * for telling the operator what must be unlocked before a control works. Used by
 * the kit's lock mark and lock scope.
 */
export function lockSentence(
  locks: readonly CapabilityLock[],
  write: LockQuantityWriter,
): {
  reason: string;
  hint?: string;
} {
  const missing = uniqueMissing(locks);
  const tech = missing.filter((m) => m.kind === UnlockKind.Tech);
  const facilities = missing.filter((m) => m.kind === UnlockKind.Facility);
  if (tech.length > 0) {
    const [only] = tech;
    return {
      reason: `Missing tech: ${tech.map((m) => m.name).join(", ")}`,
      hint:
        facilities.length > 0
          ? facilities
              .map((m) => `${m.name}: ${levelSentence([m], write)}`)
              .join(", ")
          : tech.length === 1 && only.scienceCost != null
            ? `${write(only.scienceCost, "science")} to research`
            : undefined,
    };
  }
  if (facilities.length > 0) {
    return {
      reason: facilities.map((m) => m.name).join(", "),
      hint: levelSentence(facilities, write),
    };
  }
  return { reason: "Not unlocked yet", hint: locks[0]?.detail };
}

/** "Needs Building level N" when the facilities agree on a level, each named with its own when they do not. */
function levelSentence(
  facilities: readonly MissingUnlock[],
  write: LockQuantityWriter,
): string | undefined {
  const tiers = facilities.flatMap((m) =>
    m.tier == null ? [] : [{ name: m.name, level: write(m.tier, "count") }],
  );
  if (tiers.length === 0) return undefined;
  if (tiers.every((m) => m.level === tiers[0].level)) {
    return `Needs Building level ${tiers[0].level}`;
  }
  return `Needs ${tiers.map((m) => `${m.name} level ${m.level}`).join(", ")}`;
}

function uniqueMissing(locks: readonly CapabilityLock[]): MissingUnlock[] {
  const seen = new Map<string, MissingUnlock>();
  for (const lock of locks) {
    for (const m of lock.missing) seen.set(`${m.kind}:${m.id}`, m);
  }
  return [...seen.values()];
}

function keyOf(capability: Capability): string {
  return `${capability.kind}:${capability.id}`;
}

/**
 * The scope half: what a `Section` or the dashboard's widget guard runs to
 * learn whether anything used inside it is locked. Returns the scope to
 * provide and the locks that currently hold it shut. Useful for showing the
 * operator one lock message for a whole section instead of one per control.
 * Used by the kit's lock scope.
 *
 * A locked scope stops rendering what claimed the lock, which releases the
 * claim, which would reopen the scope, which would claim again. So a
 * capability that locked the scope is held until the report says it is
 * unlocked, whether or not anything still claims it.
 *
 * The mod reports the verdict of a Topic in a keyed namespace only while that
 * Topic is subscribed, so a held Topic stays subscribed by the scope itself:
 * once its readers unmount, a missing verdict would otherwise read as unlocked
 * and reopen the scope on every other gate pass.
 */
export function useLockScope(): {
  scope: LockScopeRegistry;
  locks: readonly CapabilityLock[];
} {
  const report = useLatestValue<CommandGateReport>("system.uplink.gates");
  const reportRef = useRef(report);
  reportRef.current = report;
  const claims = useRef(
    new Map<string, { capability: Capability; count: number }>(),
  );
  /*
   * Claims live in a ref and re-render the scope only when the capability is
   * locked right now. Nearly every claim is of something unlocked, and a
   * re-render per scope on mount would be paid by every widget on every save.
   * A report that changes re-renders the scope anyway, and the locks below are
   * recomputed from the ref then.
   */
  const [, setVersion] = useState(0);
  const parent = useContext(LockScopeContext);
  // gonogo:reads none
  const client = useTelemetryClientOptional();
  // gonogo:reads none
  const store = useTelemetryStoreOptional();
  /*
   * One subscription per Topic that is claimed or held locked, taken when the
   * claim is made so the wire never sees the readers' unsubscribe before the
   * scope's own subscribe.
   */
  const interest = useRef(new Map<string, () => void>());
  const scope = useMemo<LockScopeRegistry>(
    () => ({
      observe(capability) {
        parent?.observe?.(capability);
      },
      claim(capability) {
        parent?.observe?.(capability);
        const key = keyOf(capability);
        const entry = claims.current.get(key);
        if (
          capability.kind === "topic" &&
          client &&
          store &&
          !interest.current.has(capability.id)
        ) {
          interest.current.set(
            capability.id,
            subscribeTopicRead(client, store, capability.id, "lock-scope"),
          );
        }
        claims.current.set(key, {
          capability,
          count: (entry?.count ?? 0) + 1,
        });
        const lockedNow = () =>
          capabilityLock(reportRef.current, capability) !== undefined;
        if (!entry && lockedNow()) setVersion((v) => v + 1);
        return () => {
          const current = claims.current.get(key);
          if (current && current.count > 1) {
            claims.current.set(key, { ...current, count: current.count - 1 });
            return;
          }
          claims.current.delete(key);
          if (lockedNow()) {
            setVersion((v) => v + 1);
            return;
          }
          if (capability.kind !== "topic") return;
          interest.current.get(capability.id)?.();
          interest.current.delete(capability.id);
        };
      },
    }),
    [parent, client, store],
  );

  const held = useRef<ReadonlyMap<string, Capability>>(new Map());
  const candidates = new Map(held.current);
  for (const [key, { capability }] of claims.current) {
    candidates.set(key, capability);
  }
  const locks: CapabilityLock[] = [];
  for (const capability of candidates.values()) {
    const lock = capabilityLock(report, capability);
    if (lock) locks.push(lock);
  }
  held.current = new Map(
    locks.map((lock) => [keyOf(lock.capability), lock.capability]),
  );

  useEffect(() => {
    const wanted = new Set<string>();
    for (const { capability } of claims.current.values()) {
      if (capability.kind === "topic") wanted.add(capability.id);
    }
    for (const capability of held.current.values()) {
      if (capability.kind === "topic") wanted.add(capability.id);
    }
    for (const [topic, release] of interest.current) {
      if (wanted.has(topic)) continue;
      release();
      interest.current.delete(topic);
    }
  });
  useEffect(
    () => () => {
      for (const release of interest.current.values()) release();
      interest.current.clear();
    },
    [],
  );

  return { scope, locks };
}
