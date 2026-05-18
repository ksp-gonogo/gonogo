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
const APP_PORT = 5173;
const TELEMACHUS_REPLAY_PORT = 8086;
// Relay (OCISLY camera fan-out) + a fake OCISLY gRPC backend so the
// media-stream test exercises the real WebRTC pipe without needing a
// linux/amd64-only OCISLY container. Ports match production defaults
// for the relay (3002) so the app's default discovery works without
// extra env vars; the fake OCISLY uses 5078 (one above the production
// 5077) to leave room for a real OCISLY in docker to run alongside.
const RELAY_PORT = 3002;
const FAKE_OCISLY_PORT = 5078;

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
      command: "pnpm --filter @gonogo/app dev",
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
