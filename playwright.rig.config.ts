import { defineConfig, devices } from "@playwright/test";

/**
 * Rig sessions: the app driven against a REAL running game, not a fixture.
 *
 * A separate project from `playwright.config.ts` because the two want opposite
 * settings. The e2e suite boots its own deterministic stack and keeps a trace
 * only when something fails; a rig session points at a live Deck whose state
 * nobody controls, and the run that SUCCEEDS is usually the one worth watching
 * back. So tracing is unconditional here.
 *
 * <p>Nothing in this project runs in CI: it needs a rig. `pnpm rig` is the only
 * way in, and it takes the host from `RIG_HOST` so the address is stated once
 * rather than baked into every spec.</p>
 *
 * <p>Traces land in `local_docs/traces/`, which is gitignored, and are PRUNED on
 * every run by `tests/rig/prune-traces.ts`. An always-on trace of a
 * multi-minute session is tens of megabytes; without the prune the directory is
 * a slow leak nobody notices until a disk fills.</p>
 */
const RIG_HOST = process.env.RIG_HOST ?? "192.168.86.33";
const RIG_SITREP_PORT = process.env.RIG_SITREP_PORT ?? "8090";
const APP_PORT = 5273;

export default defineConfig({
  testDir: "./tests/rig",
  testMatch: /.*\.rig\.spec\.ts$/,
  // Generous: a rig session waits on a real game, and the flight scene alone
  // takes minutes to settle after a restart.
  timeout: 10 * 60_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  // Never in CI, and a rig failure is a finding rather than a flake: a retry
  // would write a second trace over the state the first one left behind.
  retries: 0,
  workers: 1,
  reporter: "list",
  globalSetup: "./tests/rig/prune-traces.ts",
  outputDir: "./local_docs/traces/artifacts",
  use: {
    baseURL: `http://localhost:${APP_PORT}`,
    // On, always. The point of a rig session is watching what happened.
    trace: "on",
    video: "on",
    screenshot: "on",
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
    ...devices["Desktop Chrome"],
    viewport: { width: 1600, height: 1100 },
  },
  webServer: {
    command: "pnpm --filter @ksp-gonogo/app dev",
    port: APP_PORT,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      VITE_SITREP_HOST: RIG_HOST,
      VITE_SITREP_PORT: RIG_SITREP_PORT,
      // The app's dev port, which the webServer block above waits on.
      PORT: String(APP_PORT),
    },
  },
});
