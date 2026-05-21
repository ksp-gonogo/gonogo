// Performance sampler for the kerbcam baseline harness.
// See local_docs/kerbcam/baseline_harness_plan.md for the measurement strategy.
// Activated by KERBCAM_BASELINE=1 env var; no-op otherwise.

const ENABLED = process.env.KERBCAM_BASELINE === "1";
const FLUSH_INTERVAL_MS = 1000;
const SAMPLE_WINDOW = 256;

interface StageSamples {
  samples: number[];
  total: number;
}

interface CameraSamples {
  stages: Map<string, StageSamples>;
  timestampPairs: Array<{ kspMs: number; relayMs: number }>;
}

const cameras = new Map<string, CameraSamples>();
let flushTimer: NodeJS.Timeout | null = null;

function percentile(arr: number[], pct: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(
    sorted.length - 1,
    Math.floor((pct / 100) * sorted.length),
  );
  return sorted[idx];
}

function ensureFlushTimer() {
  if (flushTimer || !ENABLED) return;
  flushTimer = setInterval(flush, FLUSH_INTERVAL_MS);
  flushTimer.unref();
}

function getOrCreate(cameraId: string): CameraSamples {
  let entry = cameras.get(cameraId);
  if (!entry) {
    entry = { stages: new Map(), timestampPairs: [] };
    cameras.set(cameraId, entry);
  }
  return entry;
}

export function recordStage(
  cameraId: string,
  stage: string,
  durationMs: number,
): void {
  if (!ENABLED) return;
  const entry = getOrCreate(cameraId);
  let stageData = entry.stages.get(stage);
  if (!stageData) {
    stageData = { samples: [], total: 0 };
    entry.stages.set(stage, stageData);
  }
  stageData.samples.push(durationMs);
  if (stageData.samples.length > SAMPLE_WINDOW) stageData.samples.shift();
  stageData.total += 1;
  ensureFlushTimer();
}

export function recordTimestampPair(
  cameraId: string,
  kspMs: number,
  relayMs: number,
): void {
  if (!ENABLED) return;
  const entry = getOrCreate(cameraId);
  entry.timestampPairs.push({ kspMs, relayMs });
  if (entry.timestampPairs.length > SAMPLE_WINDOW) entry.timestampPairs.shift();
  ensureFlushTimer();
}

export function flush(): void {
  for (const [cameraId, samples] of cameras) {
    const stages: Record<string, { p50: number; p95: number; count: number }> =
      {};
    for (const [stage, data] of samples.stages) {
      stages[stage] = {
        p50: percentile(data.samples, 50),
        p95: percentile(data.samples, 95),
        count: data.total,
      };
    }
    const tsPairs = samples.timestampPairs.slice();
    samples.timestampPairs.length = 0;
    process.stdout.write(
      `${JSON.stringify({
        tag: "kerbcam-baseline",
        ts: Date.now(),
        cameraId,
        stages,
        timestampPairs: tsPairs,
      })}\n`,
    );
  }
}

export function shutdown(): void {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
    if (ENABLED) flush();
  }
}

export const baselineEnabled = ENABLED;
