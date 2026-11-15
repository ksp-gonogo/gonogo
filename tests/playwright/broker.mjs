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
import { createSocket } from "node:dgram";
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
  // Allow same-tab and cross-tab connections without auth, this is a throwaway test broker bound to localhost.
  allow_discovery: true,
});

/*
 * The public broker, 0.peerjs.com, passes an OFFER or ANSWER only when its
 * payload is PeerJS's own: type "data" or "media", with a real session
 * description. Anything else is never delivered, and the sender's socket is
 * closed about 35 ms later. This broker does the same, so a join that would
 * not get through there does not get through here either. `peer` emits
 * "message" before it hands the message on, and has no handler for the type
 * it is renamed to.
 */
server.on("message", (client, message) => {
  if (message.type !== "OFFER" && message.type !== "ANSWER") return;
  const payload = message.payload ?? {};
  const sdp = payload.sdp?.sdp;
  const own = payload.type === "data" || payload.type === "media";
  if (own && typeof sdp === "string" && sdp.includes("\nm=")) return;
  process.stdout.write(
    `[broker] refused a ${message.type} from ${client.getId()} (payload type ${payload.type}), closing its socket\n`,
  );
  message.type = "REFUSED";
  setTimeout(() => client.getSocket()?.close(), 35);
});

/**
 * The address this machine sends from by default, or null with no route out.
 * Connecting a datagram socket picks the route and sends nothing.
 */
function defaultRouteAddress() {
  return new Promise((resolve) => {
    const socket = createSocket("udp4");
    const done = (address) => {
      socket.close();
      resolve(address);
    };
    socket.once("error", () => done(null));
    socket.connect(9, "192.0.2.1", () => done(socket.address().address));
  });
}

const ownAddress = await defaultRouteAddress();
const MDNS_NAME = /\b[0-9a-f-]{36}\.local\b/gi;
let rewrote = false;

/*
 * WebKit publishes its own address as a one-off mDNS name, and the page at the
 * other end has to resolve that name to reach it. Every screen in a run is on
 * this one machine, and whether a `.local` name resolves there is a property of
 * the machine: on a runner where it does not, the two pages exchange candidates
 * and stay in ICE checking until the test gives up. The name stands for the
 * address this machine sends from, so the broker puts that address in its
 * place and the join no longer depends on the resolver.
 */
server.on("message", (_client, message) => {
  if (message.type !== "CANDIDATE" || ownAddress === null) return;
  const candidate = message.payload?.candidate;
  if (typeof candidate?.candidate !== "string") return;
  const resolved = candidate.candidate.replace(MDNS_NAME, ownAddress);
  if (resolved === candidate.candidate) return;
  candidate.candidate = resolved;
  if (rewrote) return;
  rewrote = true;
  process.stdout.write(
    "[broker] mDNS host candidates are passed on with this machine's address\n",
  );
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
