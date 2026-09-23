import { logger } from "@ksp-gonogo/logger";
import {
  DelayAuthority,
  getValue,
  setActiveTelemetryClientForTests,
  setActiveTimelineStoreForTests,
  setActiveViewClockForTests,
  TelemetryClient,
  TimelineStore,
  ViewClock,
  WebSocketTransport,
} from "@ksp-gonogo/sitrep-client";
import { isValue, type Value, value } from "@ksp-gonogo/sitrep-sdk";
import { writeQuantity } from "@ksp-gonogo/ui-kit";
import { AlarmHostService } from "./AlarmHostService";
import {
  classifyShadowRun,
  DELAY_FORMAT,
  type ShadowRunVerdict,
} from "./shadowAcceptance";

/**
 * The one-way delay a decoded `comms.delay` payload reports, or `null` when it
 * reports none.
 *
 * The field decodes to a seconds `Value`, never a bare number, so a reader that
 * expects a number sees every real reading as absent and the run as delay-free.
 * Anything that is not a finite, non-negative seconds value reads as absent.
 */
export function reportedOneWay(payload: unknown): Value | null {
  if (typeof payload !== "object" || payload === null) return null;
  if (!("oneWaySeconds" in payload)) return null;
  const reading = payload.oneWaySeconds;
  if (!isValue(reading) || reading.unit !== "s") return null;
  return reading.isFinite() && !reading.lessThan(0) ? reading : null;
}

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

export interface ShadowAcceptanceOptions {
  host: string;
  port: number;
  observeMs: number;
  /** Laps the scenario flies; every armed alarm must agree on each of them. */
  laps?: number;
  /** How often to print a progress line, ms. */
  progressEveryMs?: number;
  write?: (line: string) => void;
}

export interface ShadowAcceptanceResult {
  verdict: ShadowRunVerdict;
  /** The last one-way delay `comms.delay` reported, `null` if it never reported one. */
  owlt: Value | null;
  /**
   * Alarms, by name, whose reading never resolved to a number during the run.
   *
   * A threshold whose value cannot be read stays pending exactly as one whose
   * condition has not come true, and fires nothing for the classifier to
   * compare, so a run with any name here is evidence about the harness or the
   * stream rather than about the two evaluators.
   */
  unread: readonly string[];
  /** Each alarm's state when the run ended, by name. */
  finalStates: Record<string, string>;
}

/**
 * The shadow comparison's acceptance run, driven rather than watched.
 *
 * Stands the REAL client half up against a real mod: `AlarmHostService` with an
 * in-memory store, a `WebSocketTransport` to the stream, and the alarms armed
 * through the same path the UI uses. The clock and command loss inference take
 * their delay from one `DelayAuthority`, wired the way `TelemetryProvider` wires
 * it, so the run sees the link the operator's screen would.
 *
 * The verdict is `classifyShadowRun`'s, which has its own suite and is the half
 * that can say no.
 */
export async function runShadowAcceptance(
  options: ShadowAcceptanceOptions,
): Promise<ShadowAcceptanceResult> {
  const write = options.write ?? (() => {});
  const transport = new WebSocketTransport({
    host: options.host,
    port: options.port,
  });
  const client = new TelemetryClient(transport);
  const authority = new DelayAuthority();
  const clock = new ViewClock({
    nowWall: () => Date.now() / 1000,
    warpRate: () => 1,
    delaySeconds: authority.delaySeconds,
  });
  const store = new TimelineStore(clock);
  const detachStore = client.attachStore(store);
  /*
   * A store publishes nothing a reader can sample until a frame is begun, and
   * the provider is what begins them: one per ingest and one per clock tick,
   * coalesced. Without it every threshold reads nothing and never fires, while
   * a direct `subscribe` callback, which bypasses the store, still sees the
   * stream.
   */
  let framePending = false;
  const scheduleFrame = () => {
    if (framePending) return;
    framePending = true;
    queueMicrotask(() => {
      framePending = false;
      store.beginFrame();
    });
  };
  const stopIngestFrames = client.subscribeStore(scheduleFrame);
  const stopClockFrames = clock.onFrame(scheduleFrame);
  const detachAuthority = authority.attach(client);
  const clearDelaySource = client.setDelaySource(authority.delaySeconds);
  setActiveTelemetryClientForTests(client);
  setActiveTimelineStoreForTests(store);
  setActiveViewClockForTests(clock);

  let owlt: Value | null = null;
  const unsubscribes = [
    client.subscribe("comms.delay", (payload) => {
      owlt = reportedOneWay(payload) ?? owlt;
    }),
    client.subscribe("vessel.flight", () => {}),
    client.subscribe("vessel.identity", () => {}),
    // The store takes each topic's lane from this roster, as the provider has it.
    client.subscribe("system.uplinks", () => {}),
  ];

  const svc = new AlarmHostService(null, { storage: memoryStorage() });
  const nameOf = new Map<string, string>();
  try {
    for (const a of ALARMS) {
      const armed = svc.addAlarm({
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
      nameOf.set(armed.id, a.name);
    }

    write(
      `observing for ${writeQuantity(value("s", options.observeMs / 1000))} against ws://${options.host}:${options.port}`,
    );
    const everRead = new Set<string>();
    const sampleReads = () => {
      for (const a of ALARMS) {
        if (getValue("data", a.dataKey) !== undefined) everRead.add(a.name);
      }
    };
    const reads = setInterval(sampleReads, 250);
    const started = Date.now();
    const tick = setInterval(() => {
      const elapsed = value("s", Math.round((Date.now() - started) / 1000));
      write(
        `  ${writeQuantity(elapsed)}  owlt=${owlt === null ? "null" : writeQuantity(owlt, DELAY_FORMAT)}  alarms=${svc
          .snapshot()
          .alarms.map((x) => x.state)
          .join(
            ",",
          )}  read=${ALARMS.filter((a) => everRead.has(a.name)).length}/${ALARMS.length}`,
      );
    }, options.progressEveryMs ?? 30_000);
    await new Promise((r) => setTimeout(r, options.observeMs));
    clearInterval(tick);
    clearInterval(reads);
    sampleReads();
    const unread = ALARMS.filter((a) => !everRead.has(a.name)).map(
      (a) => a.name,
    );
    if (unread.length > 0) {
      write(`never read a value for: ${unread.join(", ")}`);
    }
    const finalStates: Record<string, string> = {};
    for (const alarm of svc.snapshot().alarms) {
      finalStates[nameOf.get(alarm.id) ?? alarm.id] = alarm.state;
    }

    const verdict = classifyShadowRun({
      entries: logger.snapshot(),
      owlt,
      laps:
        options.laps === undefined
          ? undefined
          : {
              count: options.laps,
              alarms: ALARMS.map((a) => a.name),
              alarmOf: (fire) => nameOf.get(fire.id) ?? fire.id,
            },
    });
    return { verdict, owlt, unread, finalStates };
  } finally {
    svc.dispose();
    for (const off of unsubscribes) off();
    clearDelaySource();
    detachAuthority();
    stopClockFrames();
    stopIngestFrames();
    detachStore();
    setActiveTelemetryClientForTests(undefined);
    setActiveTimelineStoreForTests(undefined);
    setActiveViewClockForTests(undefined);
    client.dispose();
    transport.dispose();
  }
}
