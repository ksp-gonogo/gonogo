// First-run tracking for the setup auto-open host (`FirstRunSetupHost`). A
// single localStorage flag, mirroring the existing boot-modal precedent
// (`AnalyticsConsentHost`'s "answered" check): except there is no yes/no answer
// to persist here, so the flag is written the moment the host opens the modal.
// That keeps the "never re-opens once dismissed" guarantee trivially true:
// closing the modal immediately still counts as seen, same as an operator who
// reads it and connects.
//
// The key still says `uplinkHubWizard` because it is the same flag an operator
// may already have set. Renaming it would re-open the modal for everyone who
// had already dismissed the wizard this replaced, which is the one thing the
// flag exists to prevent.

const STORAGE_KEY = "gonogo.uplinkHubWizard.firstRunSeen";

/** True once the first-run auto-open has fired on this browser. */
export function hasSeenFirstRunSetup(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    // Storage disabled/unavailable: fail closed (never auto-open) rather
    // than risk re-opening every boot.
    return true;
  }
}

/** Mark the first-run auto-open as fired. Idempotent. */
export function markFirstRunSetupSeen(): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, "1");
  } catch {
    // Storage disabled/unavailable: nothing to persist this session.
  }
}

/** Test-only: reset the flag so a test can exercise the unseen state again. */
export function __resetFirstRunSetupForTests(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
