import { logger } from "@ksp-gonogo/logger";
import {
  DelayAuthority,
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
  /** How often to print a progress line, ms. */
  progressEveryMs?: number;
  write?: (line: string) => void;
}

export interface ShadowAcceptanceResult {
  verdict: ShadowRunVerdict;
  /** The last one-way delay `comms.delay` reported, `null` if it never reported one. */
  owlt: Value | null;
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
  ];

  const svc = new AlarmHostService(null, { storage: memoryStorage() });
  try {
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

    write(
      `observing for ${writeQuantity(value("s", options.observeMs / 1000))} against ws://${options.host}:${options.port}`,
    );
    const started = Date.now();
    const tick = setInterval(() => {
      const elapsed = value("s", Math.round((Date.now() - started) / 1000));
      write(
        `  ${writeQuantity(elapsed)}  owlt=${owlt === null ? "null" : writeQuantity(owlt, DELAY_FORMAT)}  alarms=${svc
          .snapshot()
          .alarms.map((x) => x.state)
          .join(",")}`,
      );
    }, options.progressEveryMs ?? 30_000);
    await new Promise((r) => setTimeout(r, options.observeMs));
    clearInterval(tick);

    const verdict = classifyShadowRun({
      entries: logger.snapshot(),
      owlt,
    });
    return { verdict, owlt };
  } finally {
    svc.dispose();
    for (const off of unsubscribes) off();
    clearDelaySource();
    detachAuthority();
    detachStore();
    setActiveTelemetryClientForTests(undefined);
    setActiveTimelineStoreForTests(undefined);
    setActiveViewClockForTests(undefined);
    client.dispose();
    transport.dispose();
  }
}
