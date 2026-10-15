/**
 * First-run tracking for the setup auto-open host (`FirstRunSetupHost`): a
 * single localStorage flag, written the moment the host opens the modal. The
 * host opens it only once the analytics consent question has been answered, so
 * the flag records that the setup was shown, not that it was completed. That
 * keeps "never re-opens once dismissed" true: closing the modal immediately
 * still counts as seen.
 *
 * The key says `uplinkHubWizard` because browsers that already hold it must not
 * see the setup again, which renaming the key would cause.
 */

const STORAGE_KEY = "gonogo.uplinkHubWizard.firstRunSeen";

/** True once the first-run auto-open has fired on this browser. */
export function hasSeenFirstRunSetup(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    // Storage disabled/unavailable: fail closed (never auto-open) rather than risk re-opening every boot.
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
