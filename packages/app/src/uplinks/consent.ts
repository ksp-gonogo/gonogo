// Per-Uplink first-load consent (design §3.5 / §5 step 4). Before the loader
// import()s an Uplink it has never loaded at this id@version, the operator
// consents via a modal that names the Uplink and states the mod-hash limit; the
// grant persists so a remembered id@version never re-asks. Decline quarantines
// the Uplink with a legible reason. First-party ids are deliberately NOT
// pre-trusted — the whole point is to exercise the real consent seam before the
// Hub opens third-party loading.
//
// Generic on purpose (no mod token) so the uplink-boundary ratchet stays clean.

import { logger } from "@ksp-gonogo/logger";

const STORAGE_KEY = "gonogo.uplinkConsent";

/** Consent is keyed by id@version so a new version re-asks (new bytes to trust). */
function consentKey(id: string, version: string): string {
  return `${id}@${version}`;
}

function readGranted(): Set<string> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

export function hasConsent(id: string, version: string): boolean {
  return readGranted().has(consentKey(id, version));
}

export function grantConsent(id: string, version: string): void {
  const granted = readGranted();
  granted.add(consentKey(id, version));
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...granted]));
  } catch (err) {
    logger.warn(`[uplink-loader] could not persist consent: ${String(err)}`);
  }
}

/** Clear a remembered grant so the next load re-asks (the "Reconsider" affordance). */
export function revokeConsent(id: string, version: string): void {
  const granted = readGranted();
  if (!granted.delete(consentKey(id, version))) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...granted]));
  } catch (err) {
    logger.warn(`[uplink-loader] could not persist consent: ${String(err)}`);
  }
}

export interface ConsentInfo {
  id: string;
  name: string;
  version: string;
  author?: string;
}

/**
 * Ask the operator to consent to loading id@version. Injected at boot by main.tsx
 * with a real modal-backed implementation; defaults to "deny" so an unwired
 * context (tests, SSR) never silently trusts. Returns true to load, false to
 * quarantine as consent-declined.
 */
export type ConsentPrompt = (info: ConsentInfo) => Promise<boolean>;

let promptImpl: ConsentPrompt = async () => false;

export function setConsentPrompt(fn: ConsentPrompt): void {
  promptImpl = fn;
}

/** Resolve consent: remembered grants short-circuit; otherwise prompt and persist a grant. */
export async function ensureConsent(info: ConsentInfo): Promise<boolean> {
  if (hasConsent(info.id, info.version)) return true;
  const granted = await promptImpl(info);
  if (granted) grantConsent(info.id, info.version);
  return granted;
}
