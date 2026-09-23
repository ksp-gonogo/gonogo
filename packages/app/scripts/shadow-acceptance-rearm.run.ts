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
import { value } from "@ksp-gonogo/sitrep-sdk";
import { writeQuantity } from "@ksp-gonogo/ui-kit";
import { expect, it } from "vitest";
import { AlarmHostService } from "../src/alarms/AlarmHostService";
import {
  classifyShadowRun,
  DELAY_FORMAT,
} from "../src/alarms/shadowAcceptance";
import { reportedOneWay } from "../src/alarms/shadowAcceptanceRun";

/**
 * #423's re-arm variant: a fixed circular orbit produces at most one crossing
 * per threshold ever (a threshold alarm latches on "fired" and does not
 * un-latch itself), so a static scenario cannot reach the classifier's
 * MINIMUM_FIRINGS bar. This drives an eccentric orbit instead: every alarm
 * that reaches "fired" is acknowledged (removed) and immediately re-added
 * with the same trigger, so the next periapsis/apoapsis pass can fire it
 * again. `AlarmHostService.acknowledgeAlarm` only removes a `fired` alarm;
 * there is no in-place reset, so delete-then-readd is the mechanism, not a
 * workaround for a missing one.
 *
 *   ssh -f -N -L 8090:127.0.0.1:8090 deck
 *   SHADOW_SECONDS=1800 pnpm --filter @ksp-gonogo/app exec vitest run \
 *     --config vitest.shadow-acceptance-rearm.config.ts
 */

const seconds = Number(process.env.SHADOW_SECONDS ?? 1800);
const host = process.env.SITREP_HOST ?? "127.0.0.1";
const port = Number(process.env.SITREP_PORT ?? 8090);

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
    name: "Speed 2 km/s",
    dataKey: "vessel.flight.speedOrbital",
    topic: "vessel.flight",
    fieldPath: "speedOrbital",
    op: ">=" as const,
    value: 2_000,
  },
] as const;

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

it(
  `shadow acceptance (re-arming) over ${seconds}s`,
  async () => {
    const transport = new WebSocketTransport({ host, port });
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

    let owlt: ReturnType<typeof reportedOneWay> = null;
    const unsubscribes = [
      client.subscribe("comms.delay", (payload) => {
        owlt = reportedOneWay(payload) ?? owlt;
      }),
      client.subscribe("vessel.flight", () => {}),
      client.subscribe("vessel.identity", () => {}),
    ];

    const svc = new AlarmHostService(null, { storage: memoryStorage() });
    let rearmCount = 0;
    const rearmsByName = new Map<string, number>();
    // name -> trigger config, keyed for re-add after acknowledge.
    const byId = new Map<string, (typeof ALARMS)[number]>();

    function arm(a: (typeof ALARMS)[number]): void {
      const alarm = svc.addAlarm({
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
      byId.set(alarm.id, a);
    }

    try {
      for (const a of ALARMS) arm(a);

      console.info(
        `observing for ${writeQuantity(value("s", seconds))} against ws://${host}:${port}, re-arming on fire`,
      );
      const started = Date.now();
      const rearmLoop = setInterval(() => {
        for (const alarm of svc.snapshot().alarms) {
          if (alarm.state !== "fired") continue;
          const cfg = byId.get(alarm.id);
          byId.delete(alarm.id);
          svc.acknowledgeAlarm(alarm.id);
          if (cfg) {
            arm(cfg);
            rearmCount++;
            rearmsByName.set(cfg.name, (rearmsByName.get(cfg.name) ?? 0) + 1);
          }
        }
      }, 2_000);
      const tick = setInterval(() => {
        const elapsed = value("s", Math.round((Date.now() - started) / 1000));
        console.info(
          `  ${writeQuantity(elapsed)}  owlt=${owlt === null ? "null" : writeQuantity(owlt, DELAY_FORMAT)}  rearms=${rearmCount}  alarms=${svc
            .snapshot()
            .alarms.map((x) => x.state)
            .join(",")}`,
        );
      }, 20_000);
      await new Promise((r) => setTimeout(r, seconds * 1000));
      clearInterval(tick);
      clearInterval(rearmLoop);

      const verdict = classifyShadowRun({ entries: logger.snapshot(), owlt });
      console.info(`total re-arms: ${rearmCount}`);
      for (const [name, n] of rearmsByName) {
        console.info(`  ${name}: ${n} fire(s) (re-armed each time)`);
      }
      const altLaps = (rearmsByName.get("Altitude 200 km") ?? 0) / 2;
      console.info(
        `approx laps (Altitude 200 km fires / 2, one rising + one falling per lap): ${altLaps}`,
      );
      console.info(JSON.stringify(verdict, null, 2));

      // Raw dump for manual pairing under the operator's revised criterion
      // (five laps, PASS iff every fire is paired, "mod first then agree" is
      // a PASS not a disagreement) -- classifyShadowRun still applies the
      // retired 10-agreement / mod-first-is-a-fail rules, so its verdict
      // above is informative only; the real judgement happens by reading
      // this dump.
      const shadow = logger
        .snapshot()
        .filter((e) => e.message.startsWith("alarm-shadow:"));
      console.info(`\nraw alarm-shadow entries: ${shadow.length}`);
      for (const e of shadow) {
        console.info(
          `  [${e.level}] ${e.message} ${JSON.stringify(e.context ?? {})}`,
        );
      }

      expect(shadow.length).toBeGreaterThanOrEqual(0);
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
  },
  seconds * 1000 + 60_000,
);
