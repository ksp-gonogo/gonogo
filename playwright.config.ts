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
} as const;
