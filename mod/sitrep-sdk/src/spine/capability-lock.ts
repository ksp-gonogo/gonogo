import { useMemo, useRef, useState } from "react";
import type { CommandGateReport, GateVerdict } from "../__generated__/contract";
import { GateOutcome } from "../__generated__/contract";
import { CommandErrorCode } from "../__generated__/error-codes";
import type { Capability, LockScopeRegistry } from "./lock-scope";
import { useLatestValue } from "./use-stream";

/**
 * One unlock this save has not made yet: a tech node not researched, or a
 * facility below the tier a capability needs. `name` is the game's own title
 * for it, so the sentence an operator reads is the one the game would use.
 */
export interface MissingUnlock {
  kind: "tech" | "facility";
  /** The tech node's `techID`, or the `SpaceCenterFacility` member name. */
  id: string;
  /** The game's display title: "Advanced Construction", "Mission Control". */
  name: string;
  /** For a facility, the tier (1-based) the capability needs. */
  tier?: number;
  /** For a tech node, the science it costs to research. */
  scienceCost?: number;
}

/**
 * A verdict that can say WHICH unlock is missing. The mod's facility evaluator
 * names it only in `detail` prose today, so a lock without `missing` is still
 * a lock, worded from the prose.
 */
type VerdictWithMissing = GateVerdict & { missing?: readonly MissingUnlock[] };

/** A channel's standing verdict, the channel half of the gate report. */
interface ChannelGate {
  /** A topic id, or a namespace prefix ending in `.` that covers every topic under it. */
  topic: string;
  verdict: VerdictWithMissing;
}

/** The gate report as this module reads it: commands as published, plus the channel half. */
type LockReport = Omit<CommandGateReport, "gates"> & {
  gates: readonly { command: string; verdict: VerdictWithMissing }[];
  channels?: readonly ChannelGate[];
};

/** Why a capability is locked: the unlocks it is missing, and the evaluator's prose for when it named none. */
export interface CapabilityLock {
  capability: Capability;
  missing: readonly MissingUnlock[];
  detail?: string;
}

/**
 * Only `notUnlocked` locks a scope. A full crew roster, an occupied pad or a
 * short balance refuse one control and may clear in a minute; a capability the
 * save has not bought yet takes away everything built on it.
 */
function lockedVerdict(verdict: VerdictWithMissing | undefined): boolean {
  return (
    verdict?.outcome === GateOutcome.Fail &&
    verdict.errorCode === CommandErrorCode.NotUnlocked
  );
}

/** The longest channel entry covering `topic`, matched the way Uplink ownership is. */
function channelVerdict(
  report: LockReport,
  topic: string,
): VerdictWithMissing | undefined {
  let best: ChannelGate | undefined;
  for (const entry of report.channels ?? []) {
    const covers =
      entry.topic === topic ||
      (entry.topic.endsWith(".") && topic.startsWith(entry.topic));
    if (covers && entry.topic.length > (best?.topic.length ?? -1)) best = entry;
  }
  return best?.verdict;
}

/** The lock on one capability, or `undefined` when the report says nothing locks it. */
export function capabilityLock(
  report: CommandGateReport | undefined,
  capability: Capability,
): CapabilityLock | undefined {
  if (!report) return undefined;
  const lockReport = report as LockReport;
  const verdict =
    capability.kind === "command"
      ? lockReport.gates.find((gate) => gate.command === capability.id)?.verdict
      : channelVerdict(lockReport, capability.id);
  if (!verdict || !lockedVerdict(verdict)) return undefined;
  return {
    capability,
    missing: verdict.missing ?? [],
    detail: verdict.detail || undefined,
  };
}

/**
 * The sentence a locked scope draws. A missing tech node reads "Missing tech:
 * <node>" over what it costs to research; a building reads as its own name over
 * the level it needs, so the two kinds of unlock never read alike.
 */
export function lockSentence(locks: readonly CapabilityLock[]): {
  reason: string;
  hint?: string;
} {
  const missing = uniqueMissing(locks);
  const tech = missing.filter((m) => m.kind === "tech");
  const facilities = missing.filter((m) => m.kind === "facility");
  if (tech.length > 0) {
    const cost = tech.reduce((sum, m) => sum + (m.scienceCost ?? 0), 0);
    return {
      reason: `Missing tech: ${tech.map((m) => m.name).join(", ")}`,
      hint:
        facilities.length > 0
          ? facilities.map((m) => `${m.name}: ${levelSentence([m])}`).join(", ")
          : cost > 0
            ? `${cost} science to research`
            : undefined,
    };
  }
  if (facilities.length > 0) {
    return {
      reason: facilities.map((m) => m.name).join(", "),
      hint: levelSentence(facilities),
    };
  }
  return { reason: "Not unlocked yet", hint: locks[0]?.detail };
}

/** "Needs Building level N" when the facilities agree on a level, each named with its own when they do not. */
function levelSentence(
  facilities: readonly MissingUnlock[],
): string | undefined {
  const tiers = facilities.filter((m) => m.tier !== undefined);
  if (tiers.length === 0) return undefined;
  if (tiers.every((m) => m.tier === tiers[0].tier)) {
    return `Needs Building level ${tiers[0].tier}`;
  }
  return `Needs ${tiers.map((m) => `${m.name} level ${m.tier}`).join(", ")}`;
}

function uniqueMissing(locks: readonly CapabilityLock[]): MissingUnlock[] {
  const seen = new Map<string, MissingUnlock>();
  for (const lock of locks) {
    for (const m of lock.missing) seen.set(`${m.kind}:${m.id}`, m);
  }
  return [...seen.values()];
}

const NOTHING_STANDING: readonly Capability[] = [];

function keyOf(capability: Capability): string {
  return `${capability.kind}:${capability.id}`;
}

/**
 * The scope half: what a `Section` or the dashboard's widget guard runs to
 * learn whether anything used inside it is locked. Returns the scope to
 * provide and the locks that currently hold it shut.
 *
 * `standing` is what the scope knows it uses without rendering anything, such
 * as a widget's declared channels.
 *
 * A locked scope stops rendering what claimed the lock, which releases the
 * claim, which would reopen the scope, which would claim again. So a
 * capability that locked the scope is held until the report says it is
 * unlocked, whether or not anything still claims it.
 */
export function useLockScope(
  standing: readonly Capability[] = NOTHING_STANDING,
): {
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
  const scope = useMemo<LockScopeRegistry>(
    () => ({
      claim(capability) {
        const key = keyOf(capability);
        const entry = claims.current.get(key);
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
          if (lockedNow()) setVersion((v) => v + 1);
        };
      },
    }),
    [],
  );

  const held = useRef<ReadonlyMap<string, Capability>>(new Map());
  const candidates = new Map(held.current);
  for (const capability of standing) {
    candidates.set(keyOf(capability), capability);
  }
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

  return { scope, locks };
}
