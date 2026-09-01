// The operator's recorded decision to load past a mod/index hash DECLARATION
// disagreement (`UplinkIntegritySubject` "declaration"): channel skew, where a
// dev-channel app and a release-channel mod each honestly describe a different
// build. It is the only integrity finding this file can record a decision for,
// and `grantSkewOverride` refuses anything else rather than trusting its caller.
//
// What an override does NOT do, and the reason it can exist at all: it does not
// turn hashing off. The loader still fetches the bundle and still refuses unless
// sha256(bytes) equals the hash the index published. The override moves the
// anchor from "both parties must agree first" to "the index anchors", and the
// bytes are measured against it exactly as before.
//
// THE KEY IS THE WHOLE SAFETY ARGUMENT. It carries id, version, AND both
// hashes, so a grant is a decision about the one pair of claims the operator
// actually read. Anything that moves, a new dev build, a mod update, an index
// entry someone rewrote, produces a different key, so the refusal comes back and
// the operator sees the new pair. There is deliberately no global switch and no
// id-only grant: either would carry a decision forward onto bytes nobody looked
// at, which is the failure mode the whole gate exists to prevent.

import { logger } from "@ksp-gonogo/logger";
import {
  isOverridableIntegrityFailure,
  type UplinkIntegrityFailure,
} from "./integrity";

const STORAGE_KEY = "gonogo.uplinkSkewOverride";

/**
 * The grant key: `id@version` plus both disagreeing hashes, in fixed party
 * order so the same disagreement always keys the same regardless of which side
 * the record happened to put in `observed`.
 */
export function skewOverrideKey(
  id: string,
  version: string,
  failure: UplinkIntegrityFailure,
): string {
  return `${id}@${version}:mod=${failure.expected}:index=${failure.observed}`;
}

function readGranted(): Set<string> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function write(granted: Set<string>): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...granted]));
  } catch (err) {
    logger.warn(
      `[uplink-loader] could not persist skew override: ${String(err)}`,
    );
  }
}

/** Whether the operator has already accepted this exact pair of claims. */
export function hasSkewOverride(
  id: string,
  version: string,
  failure: UplinkIntegrityFailure,
): boolean {
  if (!isOverridableIntegrityFailure(failure)) return false;
  return readGranted().has(skewOverrideKey(id, version, failure));
}

/**
 * Record the decision. Throws for a measured finding rather than storing a key
 * that would never be read: a caller reaching here with a bundle-bytes mismatch
 * has a bug, and the loader must not learn to look for one.
 */
export function grantSkewOverride(
  id: string,
  version: string,
  failure: UplinkIntegrityFailure,
): void {
  if (!isOverridableIntegrityFailure(failure)) {
    throw new Error(
      `grantSkewOverride: ${id}@${version} is a ${failure.subject} finding, ` +
        "which is measured against fetched bytes and cannot be overridden",
    );
  }
  const granted = readGranted();
  granted.add(skewOverrideKey(id, version, failure));
  write(granted);
  logger.warn(
    `[uplink-loader] ${id}@${version}: operator accepted mod/index hash skew ` +
      `(mod ${failure.expected}, index ${failure.observed}); the bundle is ` +
      "still verified against the index hash",
  );
}

/** Withdraw a recorded decision so the next load refuses again. */
export function revokeSkewOverride(
  id: string,
  version: string,
  failure: UplinkIntegrityFailure,
): void {
  const granted = readGranted();
  if (!granted.delete(skewOverrideKey(id, version, failure))) return;
  write(granted);
  logger.info(`[uplink-loader] ${id}@${version}: skew override withdrawn`);
}

/** Test-only: forget every recorded decision. */
export function __resetSkewOverrides(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // A storage-less environment has nothing to forget.
  }
}
