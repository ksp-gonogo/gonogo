#!/usr/bin/env node
// compare-bodies.mjs
//
// Live cross-check of celestial-body data between the proven Telemachus
// (Reborn / gonogo-fork) datalink and the new gonogo-native Sitrep mod
// (Gonogo.KSP, "system.bodies" stream), while KSP runs BOTH mods at once.
// This validates the new mod's extraction against a known-good source
// before anything downstream (SystemView, MapView, OrbitView, ...) is
// migrated onto it.
//
// ── Usage ──────────────────────────────────────────────────────────────
//   node scripts/compare-bodies.mjs [host]
//
//   HOST env var / positional arg     — KSP machine (default 192.168.86.33)
//   TELEMACHUS_WS_URL env var         — overrides ws://<host>:8085/datalink
//   GONOGO_WS_URL env var             — overrides ws://<host>:8090
//
// Requires `ws` (already a root workspace dependency — see package.json).
// Run from the repo root: `node scripts/compare-bodies.mjs`.
//
// ── Prerequisite ───────────────────────────────────────────────────────
//   KSP must be running with BOTH the Telemachus fork AND the Gonogo
//   Sitrep mod (Gonogo.KSP) loaded, in a save with a vessel/scene where
//   `alwaysEvaluable` body keys resolve (flight or space-center; body
//   keys are AlwaysEvaluable=true in Telemachus so any scene should do,
//   but the Gonogo side needs GonogoAddon actually ticking).
//
// ── STATUS: UNVALIDATED AGAINST A LIVE GAME ───────────────────────────
//   This script was built with KSP NOT running (2026-07-06). It is
//   structurally sound against both protocols as read from source
//   (Telemachus fork C# + Sitrep.Contract/Sitrep.Host/Gonogo.KSP), but
//   has never been run against a live socket on either end. Expect to
//   iron out framing/timeout edge cases on first live run — see the
//   "known risk areas" note near the bottom of this header.
//
// ── What it compares ───────────────────────────────────────────────────
//   Telemachus body keys are indexed: you must read `b.number` first,
//   then loop `b.name[i]` / `b.radius[i]` / `b.o.sma[i]` / etc. for
//   i in [0, count). Per-body ORBITAL ELEMENTS *are* exposed by
//   Telemachus (b.o.sma/eccentricity/inclination/lan/argumentOfPeriapsis/
//   maae — contrary to the initial assumption that they might not be).
//   Gonogo's `system.bodies` stream returns one shot with the whole tree
//   already assembled: { bodies: [{ name, index, parentIndex, radius,
//   orbit: { sma, ecc, inc, lan, argPe, meanAnomalyAtEpoch, epoch } }] }.
//
//   Fields compared (relative-tolerance ~0.1%, absolute epsilon fallback
//   for near-zero values):
//     - radius                      (b.radius[i]              vs radius)
//     - orbit.sma                   (b.o.sma[i]               vs orbit.sma)
//     - orbit.ecc                   (b.o.eccentricity[i]      vs orbit.ecc)
//     - orbit.inc                   (b.o.inclination[i]       vs orbit.inc)
//     - orbit.lan                   (b.o.lan[i]               vs orbit.lan)
//     - orbit.argPe                 (b.o.argumentOfPeriapsis[i] vs orbit.argPe)
//     - orbit.meanAnomalyAtEpoch    (b.o.maae[i]              vs orbit.meanAnomalyAtEpoch)
//   Orbital fields are skipped for the root star (Gonogo omits `orbit`
//   entirely for parentIndex == null; Telemachus's b.o.* for the sun is
//   nonsensical too, so root-only compares radius).
//
// ── What it CANNOT compare (fields one side doesn't expose) ───────────
//   - Gonogo `orbit.epoch` — Telemachus has NO per-body epoch key. It
//     only exposes `o.epoch` for the *active vessel's* orbit
//     (VesselDataHandlers.cs:368-369), not `b.o.epoch` for an arbitrary
//     body. This field is reported as "uncomparable", never silently
//     dropped.
//   - Telemachus-only body fields Gonogo's system.bodies stream doesn't
//     carry at all (yet): b.mass, b.geeASL, b.soi, b.hillSphere,
//     b.rotationPeriod, b.rotationAngle, b.angularV, b.tidallyLocked,
//     b.rotates, b.atmosphere/b.maxAtmosphere/b.atmosphereContainsOxygen,
//     b.ocean, b.position, b.timeWarpAltitudeLimits, b.description,
//     b.orbitingBodies, b.o.PeA/ApA/period/timeToAp/timeToPe/
//     timeToTransition1/2/timeOfPeriapsisPassage/trueAnomaly/phaseAngle.
//     These are listed in the summary as "Telemachus-only, not in Gonogo
//     payload" so the report is honest about surface area, not just the
//     overlap.
//
// ── Protocols ──────────────────────────────────────────────────────────
//   Telemachus WS (ws://<host>:8085/datalink):
//     subscribe:  {"run": ["b.number"], "rate": 1000}
//     Per CLAUDE.md / scripts/gonogo_claude_tools.sh `tele_subscribe`:
//     "run" is a ONE-SHOT query (fires once, then clears) — exactly
//     what we want for a single snapshot; "+" is the persistent-stream
//     verb used for continuous subscriptions and is NOT used here.
//     Response frames are flat JSON objects keyed by the requested
//     strings, e.g. {"b.number": 8}, merged in across however many
//     frames the server chooses to split them over.
//
//   Gonogo WS (ws://<host>:8090):
//     subscribe:  {"type":"subscribe","topic":"system.bodies"}
//     (Sitrep.Contract.Subscribe / GonogoBodiesServer.ProcessSubscribe)
//     Response is first an ack EventMsg
//       {"type":"event","topic":"system.bodies","name":"subscribed","meta":{...}}
//     then StreamData<object?> frames:
//       {"type":"stream-data","topic":"system.bodies",
//        "payload":{"bodies":[{name,index,parentIndex,radius,orbit}]},
//        "meta":{...}}
//
// ── Known risk areas on first live run ─────────────────────────────────
//   - Whether Telemachus splits a big "run" response across multiple WS
//     frames (this script merges keys across frames and waits for all
//     requested keys, so it should tolerate that either way).
//   - Whether GonogoAddon is actually ticking `GonogoBodiesServer.Tick`
//     with a populated "bodies" list yet (SystemViewProvider.BuildSystemBodies
//     returns null — not an empty list — until a sample lands; this
//     script treats a null/absent `bodies` payload as a hard error with
//     a clear message rather than crashing on `undefined.length`).
//   - Exact Telemachus body ordering/indexing vs Gonogo's `index` — this
//     script does NOT assume the two sides share index space; it matches
//     purely by case-normalized `name`.

import WebSocket from "ws";

const HOST = process.argv[2] || process.env.HOST || "192.168.86.33";
const TELEMACHUS_WS_URL =
  process.env.TELEMACHUS_WS_URL || `ws://${HOST}:8085/datalink`;
const GONOGO_WS_URL = process.env.GONOGO_WS_URL || `ws://${HOST}:8090`;

const CONNECT_TIMEOUT_MS = 5_000;
const RESPONSE_TIMEOUT_MS = 10_000;
const RELATIVE_TOLERANCE = 0.001; // 0.1%

// Per-field absolute-epsilon fallback, so near-zero values (e.g.
// eccentricity ~0 for a circular body) don't get flagged as mismatches
// purely because the relative-tolerance denominator is tiny.
const ABS_EPS = {
  radius: 1, // metres
  sma: 1, // metres
  ecc: 1e-6,
  inc: 1e-4, // degrees
  lan: 1e-4, // degrees
  argPe: 1e-4, // degrees
  meanAnomalyAtEpoch: 1e-6, // radians
};

// Telemachus keys Gonogo's system.bodies stream simply doesn't carry
// (yet). Purely informational — printed in the summary, never diffed.
const TELEMACHUS_ONLY_FIELDS = [
  "b.mass",
  "b.geeASL",
  "b.soi",
  "b.hillSphere",
  "b.rotationPeriod",
  "b.rotationAngle",
  "b.angularV",
  "b.tidallyLocked",
  "b.rotates",
  "b.atmosphere",
  "b.maxAtmosphere",
  "b.atmosphereContainsOxygen",
  "b.ocean",
  "b.position",
  "b.timeWarpAltitudeLimits",
  "b.description",
  "b.orbitingBodies",
  "b.o.PeA",
  "b.o.ApA",
  "b.o.period",
  "b.o.timeToAp",
  "b.o.timeToPe",
  "b.o.timeToTransition1",
  "b.o.timeToTransition2",
  "b.o.timeOfPeriapsisPassage",
  "b.o.trueAnomaly",
  "b.o.phaseAngle",
];

// Gonogo fields Telemachus doesn't expose per-body at all.
const GONOGO_ONLY_FIELDS = [
  "orbit.epoch (Telemachus only has vessel-scoped o.epoch, not b.o.epoch)",
];

function fail(message) {
  console.error(`\nERROR: ${message}\n`);
  process.exit(1);
}

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`timed out after ${ms}ms waiting for ${label}`)),
      ms,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// ── Telemachus side ──────────────────────────────────────────────────────

function openTelemachusSocket() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(TELEMACHUS_WS_URL);
    const onError = (err) => {
      ws.removeAllListeners();
      reject(
        new Error(
          `could not connect to Telemachus at ${TELEMACHUS_WS_URL}: ${err.message}`,
        ),
      );
    };
    ws.once("error", onError);
    ws.once("open", () => {
      ws.removeListener("error", onError);
      resolve(ws);
    });
  });
}

/**
 * Sends a one-shot `run` query and resolves once every requested key has
 * appeared in some response frame (merging across as many frames as the
 * server sends), or rejects on timeout with whatever was collected.
 */
function runQuery(ws, keys, { timeoutMs = RESPONSE_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    const collected = {};
    const remaining = new Set(keys);

    const onMessage = (data) => {
      let frame;
      try {
        frame = JSON.parse(data.toString());
      } catch {
        return; // not JSON — ignore (e.g. binary frame, stray text)
      }
      for (const key of keys) {
        if (key in frame) {
          collected[key] = frame[key];
          remaining.delete(key);
        }
      }
      if (remaining.size === 0) {
        cleanup();
        resolve(collected);
      }
    };

    const timer = setTimeout(() => {
      cleanup();
      reject(
        Object.assign(
          new Error(
            `Telemachus query timed out after ${timeoutMs}ms; missing keys: ${[...remaining].join(", ")}`,
          ),
          { partial: collected },
        ),
      );
    }, timeoutMs);

    function cleanup() {
      clearTimeout(timer);
      ws.removeListener("message", onMessage);
    }

    ws.on("message", onMessage);
    ws.send(JSON.stringify({ run: keys, rate: 1000 }));
  });
}

async function collectTelemachusBodies(ws) {
  const { "b.number": rawCount } = await runQuery(ws, ["b.number"]);
  const count = Number(rawCount);
  if (!Number.isFinite(count) || count <= 0) {
    fail(
      `Telemachus returned an invalid b.number (${JSON.stringify(rawCount)}) — is a save loaded?`,
    );
  }
  console.log(`Telemachus reports ${count} bodies.`);

  const keys = [];
  for (let i = 0; i < count; i++) {
    keys.push(
      `b.name[${i}]`,
      `b.radius[${i}]`,
      `b.o.sma[${i}]`,
      `b.o.eccentricity[${i}]`,
      `b.o.inclination[${i}]`,
      `b.o.lan[${i}]`,
      `b.o.argumentOfPeriapsis[${i}]`,
      `b.o.maae[${i}]`,
    );
  }

  let raw;
  try {
    raw = await runQuery(ws, keys, { timeoutMs: RESPONSE_TIMEOUT_MS * 2 });
  } catch (err) {
    // Partial data is still useful for a diff report — surface what we
    // got, but make the truncation loud.
    console.warn(`WARNING: ${err.message}`);
    raw = err.partial || {};
  }

  const bodies = [];
  for (let i = 0; i < count; i++) {
    const name = raw[`b.name[${i}]`];
    if (name == null) continue; // never arrived — skip rather than fabricate
    bodies.push({
      name: String(name),
      radius: toNumber(raw[`b.radius[${i}]`]),
      sma: toNumber(raw[`b.o.sma[${i}]`]),
      ecc: toNumber(raw[`b.o.eccentricity[${i}]`]),
      inc: toNumber(raw[`b.o.inclination[${i}]`]),
      lan: toNumber(raw[`b.o.lan[${i}]`]),
      argPe: toNumber(raw[`b.o.argumentOfPeriapsis[${i}]`]),
      meanAnomalyAtEpoch: toNumber(raw[`b.o.maae[${i}]`]),
    });
  }
  return bodies;
}

// ── Gonogo side ──────────────────────────────────────────────────────────

function openGonogoSocket() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(GONOGO_WS_URL);
    const onError = (err) => {
      ws.removeAllListeners();
      reject(
        new Error(
          `could not connect to Gonogo at ${GONOGO_WS_URL}: ${err.message}`,
        ),
      );
    };
    ws.once("error", onError);
    ws.once("open", () => {
      ws.removeListener("error", onError);
      resolve(ws);
    });
  });
}

function collectGonogoBodies(ws) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(
        new Error(
          `Gonogo query timed out after ${RESPONSE_TIMEOUT_MS}ms waiting for a system.bodies stream-data frame`,
        ),
      );
    }, RESPONSE_TIMEOUT_MS);

    function cleanup() {
      clearTimeout(timer);
      ws.removeListener("message", onMessage);
    }

    const onMessage = (data) => {
      let frame;
      try {
        frame = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (frame.type === "error") {
        cleanup();
        reject(new Error(`Gonogo error frame: ${frame.code} ${frame.message}`));
        return;
      }
      if (frame.type === "event" && frame.topic === "system.bodies") {
        // subscribe ack — keep waiting for the actual stream-data frame.
        return;
      }
      if (frame.type === "stream-data" && frame.topic === "system.bodies") {
        cleanup();
        const payload = frame.payload;
        if (!payload || !Array.isArray(payload.bodies)) {
          reject(
            new Error(
              "Gonogo system.bodies payload has no `bodies` array yet " +
                "(SystemViewProvider.BuildSystemBodies returns null until a " +
                "sample lands — is GonogoAddon actually ticking?)",
            ),
          );
          return;
        }
        resolve(payload.bodies);
      }
    };

    ws.on("message", onMessage);
    ws.send(JSON.stringify({ type: "subscribe", topic: "system.bodies" }));
  });
}

// ── Shared helpers ────────────────────────────────────────────────────────

function toNumber(value) {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeName(name) {
  return String(name).trim().toLowerCase();
}

function fieldMatches(field, a, b) {
  if (a == null || b == null) return false;
  const absEps = ABS_EPS[field] ?? 0;
  if (Math.abs(a - b) <= absEps) return true;
  const scale = Math.max(Math.abs(a), Math.abs(b), 1e-9);
  return Math.abs(a - b) / scale <= RELATIVE_TOLERANCE;
}

function fmt(n) {
  if (n == null) return "—";
  return Number.isInteger(n) ? String(n) : n.toPrecision(8);
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Telemachus: ${TELEMACHUS_WS_URL}`);
  console.log(`Gonogo:     ${GONOGO_WS_URL}`);
  console.log(
    "Connecting to both (this needs KSP running with both mods)...\n",
  );

  let telemachusWs, gonogoWs;
  try {
    [telemachusWs, gonogoWs] = await Promise.all([
      withTimeout(
        openTelemachusSocket(),
        CONNECT_TIMEOUT_MS,
        "Telemachus connect",
      ),
      withTimeout(openGonogoSocket(), CONNECT_TIMEOUT_MS, "Gonogo connect"),
    ]);
  } catch (err) {
    fail(
      `${err.message}\n\nThis tool requires a live game — KSP running with both the ` +
        `Telemachus fork and the Gonogo Sitrep mod loaded, listening on the ports above.`,
    );
    return;
  }

  let telemachusBodies, gonogoBodies;
  try {
    [telemachusBodies, gonogoBodies] = await Promise.all([
      collectTelemachusBodies(telemachusWs),
      collectGonogoBodies(gonogoWs),
    ]);
  } catch (err) {
    fail(err.message);
    return;
  } finally {
    telemachusWs.close();
    gonogoWs.close();
  }

  const telemachusByName = new Map(
    telemachusBodies.map((b) => [normalizeName(b.name), b]),
  );
  const gonogoByName = new Map(
    gonogoBodies
      .filter((b) => b.name != null)
      .map((b) => [normalizeName(b.name), b]),
  );

  const matchedNames = [...telemachusByName.keys()].filter((n) =>
    gonogoByName.has(n),
  );
  const telemachusOnlyBodies = [...telemachusByName.keys()].filter(
    (n) => !gonogoByName.has(n),
  );
  const gonogoOnlyBodies = [...gonogoByName.keys()].filter(
    (n) => !telemachusByName.has(n),
  );

  const rows = [];
  let fieldsCompared = 0;
  let mismatches = 0;

  for (const name of matchedNames) {
    const t = telemachusByName.get(name);
    const g = gonogoByName.get(name);
    const isRoot = g.parentIndex == null;

    const fields = [["radius", t.radius, g.radius]];
    if (!isRoot) {
      const orbit = g.orbit || {};
      fields.push(
        ["sma", t.sma, orbit.sma],
        ["ecc", t.ecc, orbit.ecc],
        ["inc", t.inc, orbit.inc],
        ["lan", t.lan, orbit.lan],
        ["argPe", t.argPe, orbit.argPe],
        ["meanAnomalyAtEpoch", t.meanAnomalyAtEpoch, orbit.meanAnomalyAtEpoch],
      );
    }

    for (const [field, tVal, gVal] of fields) {
      fieldsCompared++;
      const match = fieldMatches(field, tVal, gVal);
      if (!match) mismatches++;
      const delta = tVal != null && gVal != null ? tVal - gVal : null;
      rows.push({
        body: t.name,
        field,
        telemachus: fmt(tVal),
        gonogo: fmt(gVal),
        Δ: fmt(delta),
        match: match ? "✓" : "✗ MISMATCH",
      });
    }
  }

  console.log("\n─── Field-by-field diff ───\n");
  console.table(rows);

  console.log("─── Summary ───");
  console.log(`Bodies matched by name:    ${matchedNames.length}`);
  console.log(`Fields compared:           ${fieldsCompared}`);
  console.log(`Mismatches (>0.1% + eps):  ${mismatches}`);
  if (telemachusOnlyBodies.length) {
    console.log(
      `Telemachus-only bodies (no Gonogo match): ${telemachusOnlyBodies.join(", ")}`,
    );
  }
  if (gonogoOnlyBodies.length) {
    console.log(
      `Gonogo-only bodies (no Telemachus match):  ${gonogoOnlyBodies.join(", ")}`,
    );
  }
  console.log(
    `\nFields Gonogo has that Telemachus can't supply per-body:\n  - ${GONOGO_ONLY_FIELDS.join("\n  - ")}`,
  );
  console.log(
    `\nTelemachus body fields Gonogo's system.bodies stream doesn't carry (yet):\n  - ${TELEMACHUS_ONLY_FIELDS.join(", ")}`,
  );

  if (mismatches > 0) {
    console.log(
      `\n${mismatches} mismatch(es) found — inspect the table above before trusting Gonogo's body extraction.`,
    );
    process.exitCode = 1;
  } else {
    console.log("\nAll compared fields matched within tolerance.");
  }
}

main().catch((err) => fail(err.stack || String(err)));
