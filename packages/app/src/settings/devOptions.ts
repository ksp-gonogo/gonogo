/**
 * Whether the settings that only a developer wants are shown: verbose
 * logging, the log buffer and the mod's recording and timing rows. Shown in a dev server, and in a build made with
 * `VITE_GONOGO_DEV_OPTIONS=true`; a release build hides them.
 *
 * A function rather than a constant so a test can stub the environment.
 */
export function devOptionsShown(): boolean {
  return (
    import.meta.env.DEV || import.meta.env.VITE_GONOGO_DEV_OPTIONS === "true"
  );
}

/**
 * The mod's own settings rows that are hidden unless `devOptionsShown()`.
 * Each trades load or disk for detail a developer reads, and the mod keeps
 * its value in the settings file whether or not the row is drawn.
 */
export const DEV_ONLY_CORE_ROW_PATHS: ReadonlySet<string> = new Set([
  "RECORDING/enabled",
  "SAMPLE_TIMING/enabled",
  "CONSOLE/mission.recordAllTopics",
]);
