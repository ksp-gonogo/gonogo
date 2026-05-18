import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright tests covering the browser-level surface — multi-screen
 * peer handshake, replay-driven telemetry mirror, widget-DOM mirrors,
 * notes round-trip. Boots peerjs-server + a fake Telemachus replay
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
const TELEMACHUS_REPLAY_PORT = 8086;
// Relay (OCISLY camera fan-out) + a fake OCISLY gRPC backend so the
// media-stream test exercises the real WebRTC pipe without needing a
// linux/amd64-only OCISLY container.
//
// Ports deliberately offset from production defaults (3002, 5077) so
// the test stack coexists with a developer-side `podman compose up`
// running their own relay. Without this offset `reuseExistingServer`
// would pick up the dev relay (pointed at the user's real OCISLY
// target) instead of launching ours, and the smoke spec asserted
// against the wrong target after the 2026-05-18 mid-day live test.
// The app's `DEFAULT_RELAY_URL` is overridden to match via
// `VITE_RELAY_URL` on the vite dev server below.
const RELAY_PORT = 13002;
const FAKE_OCISLY_PORT = 15078;

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
      command: "node ./tests/playwright/telemachus-replay-server.mjs",
      url: `http://localhost:${TELEMACHUS_REPLAY_PORT}/health`,
      reuseExistingServer: !process.env.CI,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 15_000,
      env: {
        TELE_REPLAY_PORT: String(TELEMACHUS_REPLAY_PORT),
      },
    },
    {
      command: "node ./tests/playwright/ocisly-fake.mjs",
      // ocisly-fake doesn't expose an HTTP port — use a short tcp-port
      // wait via the underlying gRPC port. Playwright's `port` field
      // matches that pattern.
      port: FAKE_OCISLY_PORT,
      reuseExistingServer: !process.env.CI,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 10_000,
      env: {
        FAKE_OCISLY_PORT: String(FAKE_OCISLY_PORT),
      },
    },
    {
      command: "pnpm --filter @gonogo/relay exec tsx src/index.ts",
      url: `http://localhost:${RELAY_PORT}/health`,
      reuseExistingServer: !process.env.CI,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 30_000,
      env: {
        PORT: String(RELAY_PORT),
        OCISLY_HOST: "localhost",
        OCISLY_PORT: String(FAKE_OCISLY_PORT),
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
      command: `pnpm --filter @gonogo/app exec vite --port ${APP_PORT} --strictPort`,
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
        // Override BOTH relay URL env vars — iceServers.ts uses
        // VITE_RELAY_URL (for /ice-config polling) and ocisly.ts uses
        // VITE_OCISLY_PROXY_URL (for /peer-id discovery). They happen
        // to point at the same relay in production but each reads its
        // own env, so missing either leaves part of the camera flow
        // hitting localhost:3002 (the developer's dev relay).
        VITE_RELAY_URL: `http://localhost:${RELAY_PORT}`,
        VITE_OCISLY_PROXY_URL: `http://localhost:${RELAY_PORT}`,
      },
    },
  ],
});

/** Exported so specs can reference them without re-defining ports. */
export const PORTS = {
  app: APP_PORT,
  broker: BROKER_PORT,
  telemachusReplay: TELEMACHUS_REPLAY_PORT,
  relay: RELAY_PORT,
  fakeOcisly: FAKE_OCISLY_PORT,
} as const;
