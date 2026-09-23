import { logger } from "@ksp-gonogo/logger";
import {
  DelayAuthority,
  dispatchActiveCommandTopic,
  getValue,
  getWarpState,
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
    // A 150-350km periapsis/apoapsis orbit peaks around 2,250-2,300 m/s at
    // periapsis (measured), never 3km/s -- an unreachable threshold makes
    // the laps verdict permanently INCONCLUSIVE regardless of lap count.
    name: "Speed 2 km/s",
    // The wire field is `orbitalSpeed`, not `speedOrbital` -- confirmed
    // against a live `vessel.flight` payload. The old name never resolved,
    // so this alarm was permanently `unread` regardless of orbit.
    dataKey: "vessel.flight.orbitalSpeed",
    topic: "vessel.flight",
    fieldPath: "orbitalSpeed",
    op: ">=" as const,
    value: 2000,
  },
];

export interface ShadowAcceptanceOptions {
  host: string;
  port: number;
  observeMs: number;
  /** Laps the scenario flies; every armed alarm must agree on each of them. */
  laps?: number;
  /**
   * The `time.setWarpIndex` rung to hold for the run's duration, re-applied
   * whenever the reported index drops below it. The mod itself cancels warp
   * when a command-vantage alarm comes due -- a shipped feature, not a bug --
   * so a lap scenario with several alarms per orbit needs this or a run whose
   * period assumed a warp rung stalls to the real-time period instead.
   * Undefined leaves warp exactly as the caller set it.
   */
  warpIndex?: number;
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
  // Every id this run has ever armed, mapped back to its logical alarm name
  // -- grows across re-arms, so `laps.alarmOf` can resolve a fire from any
  // generation of an alarm, not just the first.
  const nameOf = new Map<string, string>();
  let rearmCount = 0;
  const armOne = (a: (typeof ALARMS)[number]): void => {
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
  };
  try {
    /*
     * ScetAlarmBridge.buildArmArgs names a command-vantage threshold's shadow
     * arm at `client.selectedVantage ?? client.observedVantage`; with neither
     * set it returns null and `arm()` never dispatches `alarm.scet.arm` at
     * all -- no line, not even a refusal, because nothing was sent. Arming
     * immediately after construction, before the first frame has stamped
     * `observedVantage`, loses that alarm's shadow arm PERMANENTLY: the
     * bridge's reconcile loop marks an id `commandedSinceRoster` on its first
     * attempt regardless of outcome and never retries the same id. So: wait
     * for a real vantage before arming anything.
     */
    const vantageDeadline = Date.now() + 10_000;
    while (
      client.selectedVantage === undefined &&
      client.observedVantage === undefined &&
      Date.now() < vantageDeadline
    ) {
      await new Promise((r) => setTimeout(r, 100));
    }
    write(
      `observed vantage before arming: ${client.selectedVantage ?? client.observedVantage ?? "(none after 10s)"}`,
    );

    function conditionTrue(a: (typeof ALARMS)[number]): boolean {
      const v = getValue("data", a.dataKey);
      if (v === undefined) return true; // unreadable: do not arm into the unknown
      const op: string = a.op;
      switch (op) {
        case ">=":
          return v >= a.value;
        case ">":
          return v > a.value;
        case "<=":
          return v <= a.value;
        case "<":
          return v < a.value;
        default:
          return true;
      }
    }

    /*
     * `ScetAlarmBridge.arm` is only ever called for an alarm the CLIENT
     * itself is still watching in `state: "pending"` -- deliberately, per its
     * own comment: an alarm already fired must not be re-armed after a
     * timeline reset, since its instant is in the past. A threshold
     * level-triggers on its first reading, including one already true at arm
     * time, so an alarm armed while its condition already holds skips
     * "pending" and goes straight to "firing"/"fired" on the very next tick
     * -- and the mod is NEVER told to watch it: no `alarm.scet.arm`, no
     * refusal, nothing, because `arm()` was never called for it at all.
     *
     * So every alarm here, first arming included, waits in `pendingRearm`
     * until its own condition reads false before `armOne` runs -- the same
     * hysteresis a re-arm needs, now applied uniformly rather than only after
     * a fire.
     */
    const pendingRearm = new Set<(typeof ALARMS)[number]>();
    for (const a of ALARMS) {
      if (conditionTrue(a)) pendingRearm.add(a);
      else armOne(a);
    }

    /*
     * A lap scenario re-arms by creating a fresh alarm per crossing:
     * `AlarmHostService.acknowledgeAlarm` only clears a `fired` alarm and
     * removes it, it does not reset it to `pending` in place (a same-kind
     * trigger edit would leave `state: "fired"` untouched), so the only way
     * an alarm can fire on a later lap is a brand new id.
     *
     * Re-arming the instant a fire is acknowledged, while the vessel is still
     * past the threshold, would fire the fresh alarm again immediately -- a
     * self-refire storm keyed to evaluation jitter rather than a real orbital
     * crossing, the same problem as the unshadowable-first-arm one above.
     * `pendingRearm` holds a fired alarm's config until its OWN reading goes
     * back false, so the next arm only happens once the vessel has genuinely
     * left the zone and can cross into it again.
     *
     * The clearing half of this loop (acknowledging a `fired` alarm and
     * queueing it) only runs when `options.laps` is set: a plain single-shot
     * acceptance run has no lap count to re-arm against and should keep
     * firing each alarm once. The arming half runs unconditionally, since it
     * also covers the first-arm case seeded above.
     */
    /*
     * The mod's own fired notice for THIS alarm id is the other half of the
     * evidence (`onShadowFired`/`alarm.scet.fired`), and it arrives on the
     * mod's own schedule -- at least one owlt round trip after the crossing,
     * observed directly against the live rig as several seconds. Acknowledging
     * (and so removing) a fired alarm the moment this loop next polls can beat
     * that notice home: the mod's verdict then names an id this client no
     * longer holds, which is exactly "mod fired an alarm this client does not
     * hold" -- a real divergence caused by the harness's own churn, not by the
     * two evaluators disagreeing. `firedSeenAt` holds a grace window open so
     * the slower side has time to arrive before the id is recycled.
     */
    const REARM_GRACE_MS = 10_000;
    const firedSeenAt = new Map<string, number>();
    const rearmLoop: ReturnType<typeof setInterval> = setInterval(() => {
      if (options.laps !== undefined) {
        for (const alarm of svc.snapshot().alarms) {
          if (alarm.state !== "fired") continue;
          const seenAt = firedSeenAt.get(alarm.id);
          if (seenAt === undefined) {
            firedSeenAt.set(alarm.id, Date.now());
            continue;
          }
          if (Date.now() - seenAt < REARM_GRACE_MS) continue;
          firedSeenAt.delete(alarm.id);
          const name = nameOf.get(alarm.id);
          svc.acknowledgeAlarm(alarm.id);
          const cfg = ALARMS.find((a) => a.name === name);
          if (cfg) pendingRearm.add(cfg);
        }
      }
      for (const cfg of pendingRearm) {
        if (conditionTrue(cfg)) continue; // still past the line, wait
        pendingRearm.delete(cfg);
        armOne(cfg);
        rearmCount++;
      }
    }, 2_000);

    /*
     * The mod cancels warp itself when a command-vantage alarm comes due --
     * intentional, not a defect -- so a lap scenario with several alarms per
     * orbit gets several warp-cancelling events per lap. Left alone, the run
     * settles to the orbit's REAL-TIME period after the first fire. Holding
     * the rung is exactly what an operator watching the screen would do, so
     * re-applying it here is not gaming the scenario.
     */
    let warpReapplyCount = 0;
    let warpReapplyLoop: ReturnType<typeof setInterval> | undefined;
    if (options.warpIndex !== undefined) {
      const targetIndex = options.warpIndex;
      warpReapplyLoop = setInterval(() => {
        const current = getWarpState()?.warpRateIndex;
        if (current !== undefined && current < targetIndex) {
          dispatchActiveCommandTopic("time.setWarpIndex", {
            index: targetIndex,
          });
          warpReapplyCount++;
        }
      }, 2_000);
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
          )}  pendingRearm=${pendingRearm.size}  read=${ALARMS.filter((a) => everRead.has(a.name)).length}/${ALARMS.length}  rearms=${rearmCount}  warpReapplies=${warpReapplyCount}`,
      );
    }, options.progressEveryMs ?? 30_000);
    await new Promise((r) => setTimeout(r, options.observeMs));
    clearInterval(tick);
    clearInterval(reads);
    clearInterval(rearmLoop);
    if (warpReapplyLoop !== undefined) clearInterval(warpReapplyLoop);
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
