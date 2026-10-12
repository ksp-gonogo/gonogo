/*
 * The alarms dialog's threshold form and its list, driven by the app's own
 * component over a fixture stream.
 */
import "./setup";
import { useEffect, useRef } from "react";
import { AlarmsModal } from "../../app/src/alarms/AlarmsModal";
import type { Alarm, AlarmSnapshot } from "../../app/src/alarms/types";
import { FixtureStream } from "./FixtureStream";

const SNAPSHOT: AlarmSnapshot = {
  alarms: [
    {
      id: "a1",
      name: "Pad clear",
      trigger: {
        kind: "threshold",
        dataKey: "vessel.flight.altitudeAsl",
        op: ">=",
        value: 500,
        sustainSeconds: 0,
        vantage: "scet",
        topic: "vessel.flight",
        fieldPath: "altitudeAsl",
      },
      state: "pending",
      createdBy: "main",
      createdAt: 0,
    },
    {
      id: "a2",
      name: "Apoapsis soon",
      trigger: {
        kind: "threshold",
        dataKey: "vessel.orbit.timeToApoapsis",
        op: "<=",
        value: 30,
        sustainSeconds: 0,
        vantage: "scet",
        topic: "vessel.orbit",
        fieldPath: "timeToApoapsis",
      },
      state: "pending",
      createdBy: "main",
      createdAt: 0,
    },
  ] satisfies Alarm[],
  ut: 1_000_000,
  warp: { index: 0, rate: 1, mode: "UNKNOWN" },
  unscheduledWarp: null,
  warpTo: null,
  warpSafetyMarginSeconds: 5,
};

const TOPICS = ["vessel.flight", "vessel.orbit", "vessel.resources"].map(
  (topic) => ({ topic }),
);
const EMITS = [{ topic: "alarm.scet.topics", payload: TOPICS }];

function useSnapshot(): AlarmSnapshot {
  return SNAPSHOT;
}

/** Opens the threshold form, and ticks the reckoned-values box when asked. */
function Driver({
  reckoned,
  children,
}: Readonly<{ reckoned: boolean; children: React.ReactNode }>) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    let opened = false;
    const timer = setInterval(() => {
      if (!opened) {
        const tab = [
          ...root.querySelectorAll<HTMLElement>('[role="radio"]'),
        ].find((el) => /telemetry/i.test(el.textContent ?? ""));
        if (!tab) return;
        tab.click();
        opened = true;
        return;
      }
      if (reckoned) {
        root
          .querySelector<HTMLInputElement>("#alarm-include-reckoned")
          ?.click();
      }
      clearInterval(timer);
    }, 100);
    return () => clearInterval(timer);
  }, [reckoned]);
  return (
    <div ref={ref} data-story-widget style={{ maxWidth: 720 }}>
      {children}
    </div>
  );
}

export function AlarmsThresholdScene({
  reckoned,
}: Readonly<{ reckoned: boolean }>) {
  return (
    <FixtureStream subscribed={["alarm.scet.topics"]} emits={EMITS}>
      <Driver reckoned={reckoned}>
        <AlarmsModal
          useSnapshot={useSnapshot}
          onAdd={() => {}}
          onUpdate={() => {}}
          onDelete={() => {}}
        />
      </Driver>
    </FixtureStream>
  );
}
