#!/usr/bin/env node
/*
 * Throwaway: a stand-in for the Gonogo mod in the VAB, serving the design spike's
 * two Topics from a fixture and applying its commands, so the app can be recorded
 * on a machine with no game. Every other Topic is acknowledged and never sent.
 *
 *   node scripts/rig/design-fake-mod.mjs <fixture.json> [--port 8090]
 */
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { WebSocketServer } from "ws";

const fixture = JSON.parse(readFileSync(process.argv[2], "utf8"));
const port = Number(process.argv[process.argv.indexOf("--port") + 1] || 8090);
const bootId = randomUUID().replace(/-/g, "");
const craft = structuredClone(fixture.craft);
const parts = structuredClone(fixture.parts);
craft.cpus[0].nameTag = null;
craft.cpus[0].bootFile = null;
let seq = 1;
const t0 = Date.now();
const ut = () => 600_000 + (Date.now() - t0) / 1000;
const clients = new Set();

const meta = () => ({
  source: "system",
  validAt: ut(),
  seq: seq++,
  deliveredAt: ut(),
  active: true,
  staleness: 0,
  timelineEpoch: 1,
});
let holder = "";
const payloads = () => ({
  "host.record": {
    held: holder !== "",
    holderAway: false,
    holderId: holder,
    code: "FAKE",
    stations: [],
  },
  "design.editor.craft": craft,
  "design.editor.parts": parts,
  "spaceCenter.scene": { scene: process.env.FAKE_SCENE ?? "Editor" },
  ...(process.env.FAKE_FLIGHT_PARTS ? { "vessel.parts": parts } : {}),
});

function send(ws, topic) {
  const p = payloads()[topic];
  if (p !== undefined)
    ws.send(
      JSON.stringify({ type: "stream-data", topic, payload: p, meta: meta() }),
    );
}
function broadcast() {
  for (const ws of clients) for (const topic of ws.subs) send(ws, topic);
}

const base = structuredClone(craft.stages);
const fullFuel = new Map(
  craft.physics.map((p) => [
    p.id,
    p.resources.reduce((m, r) => m + r.amount * r.density, 0),
  ]),
);

/*
 * After a stocking change, every stage at or before the tank's own loses the
 * removed fuel from its masses, and the tank's stage loses it from its start
 * only; delta-v follows by the rocket equation at each stage's own Isp.
 */
function bump() {
  craft.revision += 2;
  const removed = new Map(
    craft.physics.map((p) => [
      p.id,
      fullFuel.get(p.id) -
        p.resources.reduce((m, r) => m + r.amount * r.density, 0),
    ]),
  );
  const order = craft.physics.map((p) => p.id);
  craft.stages = base.map((s) => ({ ...s }));
  for (const p of craft.physics) {
    const d = removed.get(p.id);
    if (!(d > 1e-9)) continue;
    const owner = craft.physics.find(
      (q) =>
        q.engine &&
        q.inverseStage >= 0 &&
        order.indexOf(q.id) > order.indexOf(p.id) &&
        Math.abs(order.indexOf(q.id) - order.indexOf(p.id)) <= 2,
    );
    const tankStage = owner ? owner.inverseStage : p.inverseStage;
    for (const s of craft.stages) {
      const b = base.find((x) => x.stage === s.stage);
      if (s.stage > tankStage) {
        s.startMass -= d;
        s.endMass -= d;
      }
      if (s.stage === tankStage) s.startMass -= d;
      if (b.dvVac > 0) {
        const ispVac = b.dvVac / Math.log(b.startMass / b.endMass);
        const ispAsl = b.dvAsl / Math.log(b.startMass / b.endMass);
        const ln = Math.log(
          Math.max(s.startMass, s.endMass + 1e-6) / s.endMass,
        );
        s.dvVac = ispVac * ln;
        s.dvAsl = ispAsl * ln;
        s.dvActual = s.dvAsl;
        s.burnTime = b.burnTime * (ln / Math.log(b.startMass / b.endMass));
      }
    }
  }
  for (const p of parts.parts) {
    const ph = craft.physics.find((x) => x.id === p.id);
    for (const r of ph.resources)
      if (p.resources[r.name]) p.resources[r.name].amount = r.amount;
  }
  craft.mass = craft.physics.reduce(
    (m, p) => m + p.wetMass - removed.get(p.id),
    0,
  );
}

function run(command, args) {
  const ok = (payload) => ({ success: true, payload });
  if (command === "host.claim" || command === "host.heartbeat") {
    holder = args.token;
    return ok({
      holds: true,
      holderId: holder,
      heartbeatSeconds: 5,
      graceSeconds: 15,
      generation: 1,
    });
  }
  if (command === "host.release") return ok({});
  if (command === "design.editor.setResource") {
    const ph = craft.physics.find((p) => p.id === args.partId);
    if (!ph)
      return {
        success: false,
        errorCode: "notFound",
        error: `no part ${args.partId}`,
      };
    const lines = [];
    for (const r of ph.resources) {
      if (
        args.resource === "*"
          ? r.name !== "ElectricCharge"
          : r.name === args.resource
      ) {
        r.amount = r.maxAmount * args.fraction;
        lines.push(`${r.name} ${r.amount.toFixed(1)}/${r.maxAmount}`);
      }
    }
    bump();
    return ok({ lines });
  }
  if (command === "design.kos.setTag") {
    craft.cpus[0].nameTag = args.nameTag;
    craft.revision += 1;
    return ok({ lines: [`name tag ${args.nameTag}`] });
  }
  if (command === "design.kos.deploy") {
    const hash = createHash("sha256").update(args.content).digest("hex");
    Object.assign(craft.cpus[0], {
      bootFile: `/boot/${args.file}`,
      bootFileHash: hash,
      bootScript: args.content,
    });
    craft.revision += 1;
    return ok({ bootFile: `/boot/${args.file}`, hash });
  }
  return {
    success: false,
    errorCode: "notFound",
    error: `fake mod has no ${command}`,
  };
}

const wss = new WebSocketServer({ port });
wss.on("connection", (ws) => {
  ws.subs = new Set();
  clients.add(ws);
  ws.send(
    JSON.stringify({
      type: "hello",
      bootId,
      timelineEpoch: 1,
      contractMajor: 52,
      contractMinor: 2,
      modVersion: "spike",
    }),
  );
  ws.send(
    JSON.stringify({ type: "game-state", state: "ready", scene: "EDITOR" }),
  );
  ws.on("close", () => clients.delete(ws));
  ws.on("message", (data) => {
    let m;
    try {
      m = JSON.parse(String(data));
    } catch {
      return;
    }
    if (m.type === "subscribe") {
      ws.subs.add(m.topic);
      if (m.topic.startsWith("design") || m.topic.startsWith("host"))
        console.log("sub", m.topic);
      ws.send(
        JSON.stringify({
          type: "event",
          topic: m.topic,
          name: "subscribed",
          meta: meta(),
        }),
      );
      send(ws, m.topic);
      return;
    }
    if (m.type === "unsubscribe") {
      ws.subs.delete(m.topic);
      return;
    }
    if (m.type === "command-request") {
      ws.send(
        JSON.stringify({
          type: "command-accepted",
          requestId: m.requestId,
          oneWaySeconds: 0,
        }),
      );
      const result = run(m.command, m.args ?? {});
      setTimeout(() => {
        ws.send(
          JSON.stringify({
            type: "command-response",
            requestId: m.requestId,
            result,
            meta: meta(),
          }),
        );
        broadcast();
      }, 150);
      console.log(
        m.command,
        JSON.stringify(m.args).slice(0, 120),
        result.success,
      );
    }
  });
});
console.log(`fake design mod on ${port}`);
