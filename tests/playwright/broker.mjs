#!/usr/bin/env node
/**
 * Local PeerJS broker for multi-screen Playwright tests.
 *
 * Defaults to port 9999 path /myapp. Tests boot a fresh broker per run
 * (set BROKER_PORT to randomise) and point the app at it via the
 * VITE_PEER_HOST / VITE_PEER_PORT env vars consumed by peerOptions.ts.
 *
 * Run standalone for local debug:
 *   node tests/playwright/broker.mjs
 *
 * Or via Playwright's `webServer` config: auto-started/torn-down per
 * test run.
 *
 * `key: "gonogo"` matches what PeerHostService + PeerClientService send,
 * so a host/station that find each other on the public broker also
 * find each other here.
 */
import { PeerServer } from "peer";

const PORT = Number.parseInt(process.env.BROKER_PORT ?? "9999", 10);
const PATH = process.env.BROKER_PATH ?? "/myapp";
const KEY = process.env.BROKER_KEY ?? "gonogo";
// Bind IPv4 explicitly. Left unset, `peer` passes no host to `listen`, which
// binds the dual-stack wildcard `::` and dies with EAFNOSUPPORT on a host
// built without IPv6 (the cloud dev containers are). The broker only ever
// serves localhost, so there is nothing to lose by naming the family.
const HOST = process.env.BROKER_HOST ?? "127.0.0.1";

const server = PeerServer({
  host: HOST,
  port: PORT,
  path: PATH,
  key: KEY,
  // Allow same-tab and cross-tab connections without auth, this is a
  // throwaway test broker bound to localhost.
  allow_discovery: true,
});

server.on("connection", (client) => {
  process.stdout.write(`[broker] connect ${client.getId()}\n`);
});
server.on("disconnect", (client) => {
  process.stdout.write(`[broker] disconnect ${client.getId()}\n`);
});

process.stdout.write(
  `[broker] listening on http://${HOST}:${PORT}${PATH} (key=${KEY})\n`,
);

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    process.stdout.write(`[broker] received ${sig}, shutting down\n`);
    process.exit(0);
  });
}
