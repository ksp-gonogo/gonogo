/**
 * #55 step 7's acceptance run, driven rather than watched.
 *
 * Stands the REAL client half up in Node against a real mod: `AlarmHostService`
 * and `ScetAlarmBridge` with an in-memory store, a `WebSocketTransport` pointed
 * at a tunnelled Deck stream, and the alarms armed through the same path the UI
 * uses. Nothing here is a stub except the storage, which is injectable because
 * the service already takes it.
 *
 * Deliberately NOT a test file: it needs a running game and a tunnel, so it must
 * never be collected by CI. Run it by hand.
 *
 *   ssh -f -N -L 8090:127.0.0.1:8090 deck
 *   pnpm --filter @ksp-gonogo/app exec tsx scripts/shadow-acceptance-run.mts 900
 *
 * The argument is how many seconds to observe. The verdict it prints is
 * `classifyShadowRun`'s, which has its own suite and is the half that can say
 * no.
 */
import { logger } from "@ksp-gonogo/logger";
import {
  setActiveTelemetryClientForTests,
  setActiveTimelineStoreForTests,
  setActiveViewClockForTests,
  TelemetryClient,
  TimelineStore,
  ViewClock,
  WebSocketTransport,
} from "@ksp-gonogo/sitrep-client";
import { AlarmHostService } from "../src/alarms/AlarmHostService";
import { classifyShadowRun } from "../src/alarms/shadowAcceptance";

const seconds = Number(process.argv[2] ?? 900);
const host = process.env.SITREP_HOST ?? "127.0.0.1";
const port = Number(process.env.SITREP_PORT ?? 8090);

/** An in-memory `Storage`, so no browser and no bleed between runs. */
function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => void map.delete(k),
    setItem: (k, v) => void map.set(k, v),
  } as Storage;
}

/**
 * The alarms to arm. Thresholds at the COMMAND vantage are the only kind the
 * mod shadows: a SCET alarm is already its own, and a time alarm's two
 * evaluators differ only in which clock is right, which is settled.
 */
const ALARMS = [
  {
    name: "Altitude 200 km",
    dataKey: "vessel.flight.altitudeAsl",
    topic: "vessel.flight",
    fieldPath: "altitudeAsl",
    op: ">=" as const,
    value: 200_000,
  },
  {
    name: "Altitude 300 km",
    dataKey: "vessel.flight.altitudeAsl",
    topic: "vessel.flight",
    fieldPath: "altitudeAsl",
    op: ">=" as const,
    value: 300_000,
  },
  {
    name: "Speed 3 km/s",
    dataKey: "vessel.flight.speedOrbital",
    topic: "vessel.flight",
    fieldPath: "speedOrbital",
    op: ">=" as const,
    value: 3000,
  },
];

async function main(): Promise<void> {
  const transport = new WebSocketTransport({ host, port });
  const client = new TelemetryClient(transport as never);
  const clock = new ViewClock({
    nowWall: () => Date.now() / 1000,
    warpRate: () => 1,
    delaySeconds: () => owlt ?? 0,
  });
  const store = new TimelineStore(clock);
  client.attachStore(store);
  setActiveTelemetryClientForTests(client);
  setActiveTimelineStoreForTests(store);
  setActiveViewClockForTests(clock);

  let owlt: number | null = null;
  client.subscribe("comms.delay", (payload) => {
    const v = (payload as { oneWaySeconds?: unknown } | null)?.oneWaySeconds;
    owlt = typeof v === "number" ? v : null;
  });
  client.subscribe("vessel.flight", () => {});
  client.subscribe("vessel.identity", () => {});

  const svc = new AlarmHostService(null, { storage: memoryStorage() });
  for (const a of ALARMS) {
    svc.addAlarm({
      name: a.name,
      trigger: {
        kind: "threshold",
        dataKey: a.dataKey,
        op: a.op,
        value: a.value,
        sustainSeconds: 0,
        vantage: "command",
        topic: a.topic,
        fieldPath: a.fieldPath,
      },
    });
  }

  process.stdout.write(`observing ${seconds}s against ws://${host}:${port}\n`);
  const started = Date.now();
  const tick = setInterval(() => {
    const elapsed = Math.round((Date.now() - started) / 1000);
    process.stdout.write(
      `  ${elapsed}s  owlt=${owlt === null ? "null" : owlt.toFixed(1)}  alarms=${svc
        .snapshot()
        .alarms.map((x) => x.state)
        .join(",")}\n`,
    );
  }, 30_000);

  await new Promise((r) => setTimeout(r, seconds * 1000));
  clearInterval(tick);

  const verdict = classifyShadowRun({
    entries: logger.snapshot(),
    owltSeconds: owlt,
  });
  svc.dispose();

  process.stdout.write(`\n${JSON.stringify(verdict, null, 2)}\n`);
  process.exit(verdict.verdict === "PASS" ? 0 : 1);
}

main().catch((e) => {
  process.stderr.write(`shadow acceptance run failed: ${String(e)}\n`);
  process.exit(2);
});
