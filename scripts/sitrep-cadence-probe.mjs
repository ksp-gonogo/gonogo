/**
 * #400: measure the wire cadence and the UT spacing between samples, at
 * whatever warp the game is currently at.
 *
 * Lives in the repo because ESM resolves `ws` from the importing file's own
 * directory, so a copy in a scratch directory cannot import it.
 *
 * Usage: node scripts/sitrep-cadence-probe.mjs <seconds> <label>
 */
import WebSocket from "ws";

const seconds = Number(process.argv[2] ?? 30);
const label = process.argv[3] ?? "unlabelled";
const URL = process.env.SITREP_URL ?? "ws://127.0.0.1:8090";
const UT_TOPIC = process.env.UT_TOPIC ?? "vessel.flight";

const ws = new WebSocket(URL);
const channelSnapshots = [];
const utSamples = [];

ws.on("open", () => {
  for (const topic of ["system.channels", UT_TOPIC]) {
    ws.send(JSON.stringify({ type: "subscribe", topic }));
  }
  setTimeout(() => ws.close(), seconds * 1000);
});

ws.on("message", (raw) => {
  let msg;
  try {
    msg = JSON.parse(raw.toString());
  } catch {
    return;
  }
  if (msg.type !== "stream-data") return;
  if (msg.topic === "system.channels") {
    channelSnapshots.push({ at: Date.now(), payload: msg.payload });
  } else if (msg.topic === UT_TOPIC) {
    const validAt = msg.meta?.validAt;
    if (typeof validAt === "number")
      utSamples.push({ at: Date.now(), validAt });
  }
});

ws.on("error", (e) => {
  console.error("PROBE ERROR:", e.message);
  process.exit(1);
});

ws.on("close", () => {
  const out = { label, seconds, url: URL };

  if (channelSnapshots.length < 2) {
    out.channels = `INSUFFICIENT: ${channelSnapshots.length} snapshot(s); the roster rebuilds at most once per 5 real seconds, so a window under ~15s cannot produce a rate`;
  } else {
    const a = channelSnapshots[0];
    const b = channelSnapshots[channelSnapshots.length - 1];
    const span = (b.at - a.at) / 1000;
    const rowsOf = (s) =>
      new Map((s.payload?.channels ?? []).map((r) => [r.topic, r]));
    const first = rowsOf(a);
    const last = rowsOf(b);
    const rates = [];
    for (const [topic, lastRow] of last) {
      const firstRow = first.get(topic);
      if (!firstRow) continue;
      const dEmitted = lastRow.emitted - firstRow.emitted;
      const dConsidered = lastRow.considered - firstRow.considered;
      if (dConsidered === 0 && dEmitted === 0) continue;
      rates.push({
        topic,
        emittedPerRealSec: +(dEmitted / span).toFixed(2),
        consideredPerRealSec: +(dConsidered / span).toFixed(2),
        subscribers: lastRow.subscribers,
      });
    }
    rates.sort((x, y) => y.consideredPerRealSec - x.consideredPerRealSec);
    out.spanRealSeconds = +span.toFixed(1);
    out.channelSnapshots = channelSnapshots.length;
    out.topRates = rates.slice(0, 12);
  }

  if (utSamples.length < 2) {
    out.ut = `INSUFFICIENT: ${utSamples.length} sample(s) on ${UT_TOPIC}`;
  } else {
    const gaps = [];
    for (let i = 1; i < utSamples.length; i += 1) {
      gaps.push(utSamples[i].validAt - utSamples[i - 1].validAt);
    }
    const wall = (utSamples[utSamples.length - 1].at - utSamples[0].at) / 1000;
    const utSpan =
      utSamples[utSamples.length - 1].validAt - utSamples[0].validAt;
    gaps.sort((x, y) => x - y);
    out.ut = {
      topic: UT_TOPIC,
      samples: utSamples.length,
      samplesPerRealSec: +(utSamples.length / wall).toFixed(2),
      utSpacingMin: +gaps[0].toFixed(3),
      utSpacingMedian: +gaps[Math.floor(gaps.length / 2)].toFixed(3),
      utSpacingMax: +gaps[gaps.length - 1].toFixed(3),
      utPerRealSec: +(utSpan / wall).toFixed(1),
    };
  }
  console.log(JSON.stringify(out, null, 2));
});
