// First-run tracking for the Uplink Hub wizard's auto-open host (design
// `2026-07-18-uplink-hub-wizard-design.md` §4 Decision 1 / §1's "auto-opens
// once on first boot"). A single localStorage flag, mirroring the existing
// boot-modal precedent (`AnalyticsConsentHost`'s "answered" check) — except
// the wizard has no yes/no answer to persist, so the flag is written the
// moment the host opens the modal, not on any particular step. That keeps
// the "never re-opens once dismissed/completed" guarantee trivially true:
// closing the modal immediately (before finishing) still counts as seen,
// same as an operator who clicks through to the end.

const STORAGE_KEY = "gonogo.uplinkHubWizard.firstRunSeen";

/** True once the first-run auto-open has fired on this browser. */
export function hasSeenUplinkHubWizard(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    // Storage disabled/unavailable — fail closed (never auto-open) rather
    // than risk re-opening every boot.
    return true;
  }
}

/** Mark the first-run auto-open as fired. Idempotent. */
export function markUplinkHubWizardSeen(): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, "1");
  } catch {
    // Storage disabled/unavailable — nothing to persist this session.
  }
}

/** Test-only: reset the flag so a test can exercise the unseen state again. */
export function __resetUplinkHubWizardFirstRunForTests(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
