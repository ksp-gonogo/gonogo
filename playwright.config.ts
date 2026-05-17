import { defineConfig, devices } from "@playwright/test";

/**
 * Multi-screen Playwright tests. Boots peerjs-server + Vite dev server
 * automatically via webServer. Each spec opens two browser contexts
 * (main + station) and exercises the real PeerJS handshake against the
 * local broker — no calls out to 0.peerjs.com, no fakes.
 *
 * The Vite dev server is launched with VITE_PEER_HOST/PORT/PATH set so
 * peerOptions.ts redirects the broker target. The KsP-side data sources
 * are auto-registered as normal; tests inject a replay-backed `data`
 * source after-the-fact via window injection (see specs).
 */
const BROKER_PORT = 9999;
const APP_PORT = 5173;
const TELEMACHUS_REPLAY_PORT = 8086;

export default defineConfig({
  testDir: "./tests/multiscreen",
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
      command: "node ./tests/multiscreen/broker.mjs",
      port: BROKER_PORT,
      reuseExistingServer: !process.env.CI,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 15_000,
    },
    {
      command: "node ./tests/multiscreen/telemachus-replay-server.mjs",
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
