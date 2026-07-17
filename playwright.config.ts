import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright tests covering the browser-level surface — multi-screen
 * peer handshake, replay-driven telemetry mirror, widget-DOM mirrors,
 * notes round-trip. Boots peerjs-server + a fake Sitrep stream replay
 * server + the Vite dev server automatically via webServer.
 *
 * The Vite dev server is launched with VITE_PEER_HOST/PORT/PATH set so
 * peerOptions.ts redirects the broker target. The KSP-side data sources
 * are auto-registered as normal; specs that need deterministic
 * telemetry seed the test endpoint via context.addInitScript.
 */
const BROKER_PORT = 9999;
// Offset the app port from the production-default 5173 so a running
// `pnpm dev` doesn't satisfy Playwright's `reuseExistingServer` — the
// reused vite would have stale env (no VITE_RELAY_URL override, no
// VITE_PEER_HOST override) and the test would silently target the
// developer's actual host stack instead of the test-launched one.
const APP_PORT = 15173;
// Deliberately NOT the production default 8090 — same "don't collide with a
// developer's own dev stack" rationale as APP_PORT/RELAY_PORT above.
const SITREP_REPLAY_PORT = 18090;
// The relay (/ice-config + coturn + the host-discovery registry).
//
// Port deliberately offset from the production default (3002) so the
// test stack coexists with a developer-side `podman compose up` running
// their own relay. Without the offset `reuseExistingServer` would pick
// up the dev relay instead of launching ours. The app's
// `DEFAULT_RELAY_URL` is overridden to match via `VITE_RELAY_URL` on the
// vite dev server below.
const RELAY_PORT = 13002;
// The Uplink loader is a BUILD-time mechanism (external-entry chunks + a baked
// import map exist only in `vite build`, not in the dev server), so its e2e spec
// runs against a production `vite preview` on this dedicated port — separate from
// the dev server on APP_PORT that every other spec uses. See uplink-loader.spec.ts.
const PREVIEW_PORT = 15273;

export default defineConfig({
  testDir: "./tests/playwright",
  testMatch: /.*\.spec\.ts$/,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://localhost:${APP_PORT}`,
    trace: "retain-on-failure",
    video: "retain-on-failure",
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
      // Web Serial / real-camera specs can't run where the API is absent.
      grepInvert: /@chromium-only/,
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
      grepInvert: /@chromium-only/,
    },
  ],
  webServer: [
    {
      command: "node ./tests/playwright/broker.mjs",
      port: BROKER_PORT,
      reuseExistingServer: !process.env.CI,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 15_000,
    },
    {
      command: "node ./tests/playwright/sitrep-stream-server.mjs",
      url: `http://localhost:${SITREP_REPLAY_PORT}/health`,
      reuseExistingServer: !process.env.CI,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 15_000,
      env: {
        SITREP_REPLAY_PORT: String(SITREP_REPLAY_PORT),
      },
    },
    {
      command: "pnpm --filter @ksp-gonogo/relay exec tsx src/index.ts",
      url: `http://localhost:${RELAY_PORT}/health`,
      reuseExistingServer: !process.env.CI,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 30_000,
      env: {
        PORT: String(RELAY_PORT),
        SKIP_COTURN: "1",
        // Same broker as the app — without this the relay would
        // register on peerjs.com and the host running on
        // localhost:9999 couldn't find it.
        PEER_HOST: "localhost",
        PEER_PORT: String(BROKER_PORT),
        PEER_PATH: "/myapp",
        PEER_SECURE: "0",
      },
    },
    {
      // --strictPort forces vite to bind exactly APP_PORT or fail —
      // without it vite happily falls back to the next free port when
      // a dev server is already on 5173, and Playwright then waits on
      // APP_PORT until timeout. --port pins the binding.
      // `pnpm exec vite` (instead of `pnpm dev -- …`) skips pnpm's
      // arg-forwarding rules — the latter delivered `--` to vite as a
      // literal positional, which made vite treat --port as a no-op.
      command: `pnpm --filter @ksp-gonogo/app exec vite --port ${APP_PORT} --strictPort`,
      port: APP_PORT,
      reuseExistingServer: !process.env.CI,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 60_000,
      env: {
        VITE_PEER_HOST: "localhost",
        VITE_PEER_PORT: String(BROKER_PORT),
        VITE_PEER_PATH: "/myapp",
        VITE_PEER_SECURE: "false",
        // Point the app's relay client (iceServers.ts — /ice-config +
        // the host-discovery registry) at the test relay rather than the
        // dev default (localhost:3002).
        VITE_RELAY_URL: `http://localhost:${RELAY_PORT}`,
      },
    },
    {
      // A PRODUCTION build served by `vite preview` — the only way to exercise
      // the Uplink loader (the external-entry chunks + baked import map exist
      // only in a real build). Builds once, then serves dist/ on PREVIEW_PORT;
      // uplink-loader.spec.ts targets this URL explicitly (not baseURL). Peer
      // env is baked so the previewed main screen uses the test broker, not the
      // public one, if it initialises PeerJS.
      command: `pnpm --filter @ksp-gonogo/app exec vite build && pnpm --filter @ksp-gonogo/app exec vite preview --port ${PREVIEW_PORT} --strictPort`,
      port: PREVIEW_PORT,
      reuseExistingServer: !process.env.CI,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 180_000,
      env: {
        VITE_PEER_HOST: "localhost",
        VITE_PEER_PORT: String(BROKER_PORT),
        VITE_PEER_PATH: "/myapp",
        VITE_PEER_SECURE: "false",
        VITE_RELAY_URL: `http://localhost:${RELAY_PORT}`,
      },
    },
  ],
});

/** Exported so specs can reference them without re-defining ports. */
export const PORTS = {
  app: APP_PORT,
  broker: BROKER_PORT,
  sitrepReplay: SITREP_REPLAY_PORT,
  relay: RELAY_PORT,
  preview: PREVIEW_PORT,
} as const;
