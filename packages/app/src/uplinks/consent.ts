// Per-Uplink first-load consent (design §3.5 / §5 step 4). Before the loader
// import()s an Uplink it has never loaded at this id@version, the operator
// answers for it on the first-load page, one row per Uplink. Both answers
// persist per id@version: a grant loads it without asking again, a decline
// quarantines it with a legible reason until "Reconsider" in Settings clears
// it. A new version asks again, because it is new bytes to trust.
//
// Generic on purpose (no mod token) so the uplink-boundary ratchet stays clean.

import { logger } from "@ksp-gonogo/logger";
import type { UplinkIdentity } from "./identity";

const STORAGE_KEY = "gonogo.uplinkConsent";
const DECLINED_KEY = "gonogo.uplinkConsent.declined";

/** Consent is keyed by id@version so a new version re-asks (new bytes to trust). */
function consentKey(id: string, version: string): string {
  return `${id}@${version}`;
}

function readSet(key: string): Set<string> {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((id) => typeof id === "string"));
  } catch {
    return new Set();
  }
}

function writeSet(key: string, values: Set<string>): void {
  try {
    window.localStorage.setItem(key, JSON.stringify([...values]));
  } catch (err) {
    logger.warn(`[uplink-loader] could not persist consent: ${String(err)}`);
  }
}

function remember(key: string, id: string, version: string): void {
  const values = readSet(key);
  values.add(consentKey(id, version));
  writeSet(key, values);
}

function forget(key: string, id: string, version: string): void {
  const values = readSet(key);
  if (values.delete(consentKey(id, version))) writeSet(key, values);
}

export function hasConsent(id: string, version: string): boolean {
  return readSet(STORAGE_KEY).has(consentKey(id, version));
}

export function hasDeclined(id: string, version: string): boolean {
  return readSet(DECLINED_KEY).has(consentKey(id, version));
}

export function grantConsent(id: string, version: string): void {
  forget(DECLINED_KEY, id, version);
  remember(STORAGE_KEY, id, version);
}

export function declineConsent(id: string, version: string): void {
  forget(STORAGE_KEY, id, version);
  remember(DECLINED_KEY, id, version);
}

/** Clear a remembered answer, grant or decline, so the next load asks again (the "Reconsider" affordance). */
export function revokeConsent(id: string, version: string): void {
  forget(STORAGE_KEY, id, version);
  forget(DECLINED_KEY, id, version);
}

export interface ConsentInfo {
  id: string;
  name: string;
  version: string;
  /** The declared author, absent when no source named one. */
  author?: string;
  /**
   * The same identity with each value's source, which is what the dialog reads:
   * an operator judging a bundle needs to know whether the mod vouched for the
   * name in front of them or the bundle wrote it about itself.
   */
  identity?: UplinkIdentity;
  /** True when the question is asked on a station, which answers for itself and has no logs question to add. */
  onStation?: boolean;
  /**
   * The mod this Uplink connects and the version of it the Uplink was built
   * against, as its manifest declares them. Absent when the manifest names no
   * mod.
   */
  mod?: { name?: string; builtAgainst?: string };
}

/**
 * Ask the operator about one Uplink. Defaults to "deny" so an unwired context
 * (tests, SSR) never silently trusts. Returns true to load, false to
 * quarantine as consent-declined.
 */
export type ConsentPrompt = (info: ConsentInfo) => Promise<boolean>;

/**
 * Ask the operator about several Uplinks at once, answering each in the order
 * given. The app wires the first-load page here at boot.
 */
export type ConsentBatchPrompt = (
  infos: readonly ConsentInfo[],
) => Promise<boolean[]>;

let promptImpl: ConsentPrompt = async () => false;
let batchImpl: ConsentBatchPrompt | undefined;

export function setConsentPrompt(fn: ConsentPrompt): void {
  promptImpl = fn;
  batchImpl = undefined;
}

export function setConsentBatchPrompt(fn: ConsentBatchPrompt): void {
  batchImpl = fn;
}

async function ask(infos: readonly ConsentInfo[]): Promise<boolean[]> {
  if (batchImpl) return batchImpl(infos);
  const answers: boolean[] = [];
  for (const info of infos) answers.push(await promptImpl(info));
  return answers;
}

/**
 * Resolve consent for several Uplinks with at most one prompt: remembered
 * answers short-circuit, the rest are asked together, and every answer is
 * persisted.
 */
export async function ensureConsents(
  infos: readonly ConsentInfo[],
): Promise<boolean[]> {
  const answers = infos.map((info): boolean | undefined => {
    if (hasConsent(info.id, info.version)) return true;
    if (hasDeclined(info.id, info.version)) return false;
    return undefined;
  });
  const open = infos.filter((_, n) => answers[n] === undefined);
  if (open.length > 0) {
    const given = await ask(open);
    open.forEach((info, k) => {
      const granted = given[k] === true;
      if (granted) grantConsent(info.id, info.version);
      else declineConsent(info.id, info.version);
      answers[infos.indexOf(info)] = granted;
    });
  }
  return answers.map((answer) => answer === true);
}

/** Resolve consent for one Uplink. */
export async function ensureConsent(info: ConsentInfo): Promise<boolean> {
  const [granted] = await ensureConsents([info]);
  return granted === true;
}
