// Encoded-transform capture-UT mapping spike (harness D).
//
// UNLIKE worker-a.js (which holds frames for a fixed arrival+delayMs — the
// exact thing the production invariant FORBIDS), this worker:
//   1. stamps each RTCEncodedVideoFrame with a capture-UT computed by
//      wall-clock interpolation of an out-of-band, ~1Hz "capture clock"
//      sample stream, evaluated at the transform's own read time — approach
//      1 from the report (mirrors captureClock.ts's interpolateCaptureUt);
//   2. gates release on a LOCALLY-EVALUATED confirmedEdgeUt(), fed by a
//      periodic ClockFormulaSnapshot from the main thread — the exact same
//      pure formula already shipped in
//      packages/sitrep-client/src/view-clock-formula.ts and mirrored by
//      packages/kerbcast/src/worker/workerDelayClock.ts, ported verbatim
//      here (plain JS, no bundler in this throwaway harness).
//
// The RTP timestamp on the frame is never read for timing purposes — only
// FIFO arrival order is relied on (frames are pushed/popped in read order),
// exactly as the report's design-question section argues.

let offsetMs = null; // localTimeOriginMs - mainTimeOriginMs, see timeBase.ts
let framesIn = 0;
let framesOut = 0;
let writeErrors = 0;
let peakQueueLength = 0;
let snapshotsReceived = 0;
let captureSamplesReceived = 0;
let orderingViolations = 0;
let invariantViolations = 0; // released.ut > edge at release time — should be impossible by construction
let lastReleasedUt = -Infinity;
const releaseLog = []; // sampled {ut, edge, wallMs} for a handful of releases, for the report

const COLD_SNAPSHOT = {
  epoch: 0,
  anchorWall: undefined,
  anchorUt: undefined,
  maxSampleUt: Number.NEGATIVE_INFINITY,
  delaySeconds: 0,
  warpRate: 1,
  slackSeconds: 0,
};
let currentSnapshot = COLD_SNAPSHOT;
let captureSample = { ut: null, warpRate: 1, atMs: 0 };

// --- ported verbatim from packages/kerbcast/src/worker/timeBase.ts ---
function computeTimeOriginOffsetMs(mainTimeOriginMs, localTimeOriginMs) {
  return localTimeOriginMs - mainTimeOriginMs;
}
function nowWall() {
  // (perfNowMs() + offsetMs) / 1000 — main-thread basis, seconds.
  return (performance.now() + (offsetMs ?? 0)) / 1000;
}

// --- ported verbatim from packages/sitrep-client/src/view-clock-formula.ts ---
function computeUtNowEstimate(inputs, nw) {
  if (inputs.anchorWall === undefined || inputs.anchorUt === undefined) {
    return inputs.maxSampleUt === Number.NEGATIVE_INFINITY
      ? 0
      : inputs.maxSampleUt;
  }
  const elapsed = nw - inputs.anchorWall;
  return inputs.anchorUt + elapsed * inputs.warpRate;
}
function computeConfirmedEdgeUt(inputs, nw) {
  if (inputs.maxSampleUt === Number.NEGATIVE_INFINITY) {
    return Number.NEGATIVE_INFINITY;
  }
  const estimatedEdge = computeUtNowEstimate(inputs, nw) - inputs.delaySeconds;
  const sampleClamp = inputs.maxSampleUt + inputs.slackSeconds;
  return Math.min(estimatedEdge, sampleClamp);
}

// --- ported verbatim from packages/kerbcast/src/captureClock.ts ---
function interpolateCaptureUt(sample, nowMs) {
  if (sample.ut == null) return null;
  const elapsedSec = Math.max(0, (nowMs - sample.atMs) / 1000);
  return sample.ut + elapsedSec * (sample.warpRate || 1);
}

function confirmedEdgeUt() {
  return computeConfirmedEdgeUt(currentSnapshot, nowWall());
}

function reportStats() {
  postMessage({
    kind: "stats",
    framesIn,
    framesOut,
    writeErrors,
    peakQueueLength,
    snapshotsReceived,
    captureSamplesReceived,
    orderingViolations,
    invariantViolations,
    lastCaptureSample: captureSample,
    lastSnapshot: currentSnapshot,
    releaseLogSample: releaseLog.slice(0, 10),
  });
}

function attach(readable, writable) {
  const reader = readable.getReader();
  const writer = writable.getWriter();
  /** @type {{frame: any, ut: number}[]} */
  const queue = [];
  let timer = null;

  function scheduleNext() {
    if (timer !== null) return;
    timer = setInterval(() => {
      pump();
    }, 16);
  }

  function pump() {
    const edge = confirmedEdgeUt();
    while (queue.length > 0 && queue[0].ut <= edge) {
      const item = queue.shift();
      if (item.ut > edge) {
        // Structurally unreachable given the loop guard, but assert it
        // explicitly — this IS the invariant under test.
        invariantViolations++;
      }
      if (item.ut < lastReleasedUt - 1e-6) orderingViolations++;
      lastReleasedUt = item.ut;
      if (releaseLog.length < 40) {
        releaseLog.push({ ut: item.ut, edge, wallMs: performance.now() });
      }
      writer
        .write(item.frame)
        .then(() => {
          framesOut++;
        })
        .catch((err) => {
          writeErrors++;
          postMessage({
            kind: "error",
            where: "writer.write",
            message: String(err),
          });
        });
    }
  }

  (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        framesIn++;
        // Stamp at READ time — the encoded domain's earliest available
        // point, pre-decode. This is approach 1: interpolate the SAME kind
        // of wall-clock-anchored external clock sample the decoded backend
        // already uses, just evaluated here instead of post-decode.
        const ut = interpolateCaptureUt(captureSample, nowWall() * 1000);
        if (ut != null) {
          queue.push({ frame: value, ut });
          if (queue.length > peakQueueLength) peakQueueLength = queue.length;
        } else {
          // No capture sample yet — can't stamp, drop rather than release
          // ungated (mirrors "can't delay -> no video", not "reveal anyway").
        }
        scheduleNext();
        pump();
        if (framesIn % 20 === 0) reportStats();
      }
    } catch (err) {
      postMessage({
        kind: "error",
        where: "reader.read",
        message: String(err),
      });
    }
  })();
}

self.onrtctransform = (event) => {
  postMessage({ kind: "onrtctransform-fired" });
  const transformer = event.transformer;
  attach(transformer.readable, transformer.writable);
};

self.onmessage = (event) => {
  const msg = event.data;
  if (msg?.kind === "init") {
    offsetMs = computeTimeOriginOffsetMs(
      msg.mainTimeOriginMs,
      performance.timeOrigin,
    );
    postMessage({ kind: "init-ack", offsetMs });
  } else if (msg?.kind === "capture-sample") {
    captureSamplesReceived++;
    captureSample = { ut: msg.ut, warpRate: msg.warpRate, atMs: msg.atMs };
  } else if (msg?.kind === "clock-snapshot") {
    snapshotsReceived++;
    if (msg.snapshot.epoch < currentSnapshot.epoch) return; // stale-epoch straggler
    currentSnapshot = msg.snapshot;
  } else if (msg?.kind === "get-stats") {
    reportStats();
  }
};

postMessage({ kind: "worker-ready" });
