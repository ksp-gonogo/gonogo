import { ArrowRightIcon, PlayIcon, StopIcon } from "@gonogo/ui";
import { useEffect, useState } from "react";
import styled from "styled-components";
import { useAlarmHost, useAlarmSnapshot } from "./AlarmHostContext";
import { useFireBeep } from "./alarmTone";
import type { Alarm, AlarmSnapshot } from "./types";
import {
  MAX_WARP_SAFETY_MARGIN_SECONDS,
  MIN_WARP_SAFETY_MARGIN_SECONDS,
} from "./types";

/** KSP HIGH-warp ladder — index → rate. Mirrors AlarmHostService. */
const HIGH_WARP_RATES: readonly number[] = [
  1, 5, 10, 50, 100, 1000, 10000, 100000,
];

/**
 * Persistent banner on the main screen.
 *
 * Always shows the current warp multiplier.
 * When there's an upcoming alarm, also shows its name + T-minus countdown.
 * When unscheduled-warp is flagged, a second strip offers an acknowledge
 * button. When an alarm is `arming`/`firing`, the banner colours escalate.
 */
export function AlarmBanner() {
  const snap = useAlarmSnapshot();
  const host = useAlarmHost();

  // Force a re-render each second so T-minus counts down even without
  // upstream telemetry ticks.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const nextAlarm = pickNext(snap);
  const tone = bannerTone(nextAlarm);
  const firedAlarms = snap.alarms.filter((a) => a.state === "fired");

  // The "Warp to" button targets the next pending alarm. Time alarms
  // have a fire-UT; threshold alarms get a slope-projected ETA from the
  // host's rolling sample buffer. Equality ops can't be planned against
  // (no monotonic distance), so they're excluded.
  const warpToCandidate =
    nextAlarm && nextAlarm.state === "pending" && isWarpToCandidate(nextAlarm)
      ? nextAlarm
      : null;
  const warpToTargetRate =
    snap.warpTo !== null
      ? (HIGH_WARP_RATES[snap.warpTo.targetIndex] ?? 1)
      : null;

  // Beep on every transition into firing/fired so a telemetry-triggered
  // alarm never silently vanishes. Tracks ids so subsequent re-renders
  // (from the 1Hz tick) don't replay the tone.
  useFireBeep(snap.alarms);

  return (
    <Wrap $tone={tone} role={tone === "fire" ? "alert" : "status"}>
      <Stack>
        <Row>
          <Label>Warp</Label>
          <Value>{formatWarp(snap.warp.index, snap.warp.rate)}</Value>
          {warpToTargetRate !== null && (
            <>
              <WarpArrow aria-hidden="true">
                <ArrowRightIcon size={14} />
              </WarpArrow>
              <WarpToTarget>{formatRate(warpToTargetRate)}</WarpToTarget>
            </>
          )}
          <Divider />
          {nextAlarm ? (
            <>
              <Label>
                {nextAlarm.state === "fired" ? "Fired" : "Next alarm"}
              </Label>
              <AlarmName>{nextAlarm.name}</AlarmName>
              <Countdown $tone={tone}>
                {formatNext(nextAlarm, snap.ut)}
              </Countdown>
              {nextAlarm.state === "fired" && (
                <AckButton
                  type="button"
                  onClick={() => host.acknowledgeAlarm(nextAlarm.id)}
                >
                  Acknowledge
                </AckButton>
              )}
              {snap.warpTo !== null ? (
                <StopWarpButton
                  type="button"
                  onClick={() => host.cancelWarpTo()}
                  title="Stop the managed warp and drop to 1×"
                >
                  <StopIcon size={12} /> Stop warp
                </StopWarpButton>
              ) : (
                warpToCandidate && (
                  <WarpToButton
                    type="button"
                    onClick={() => host.beginWarpTo()}
                    title="Warp toward the next alarm at the highest safe rate"
                  >
                    <PlayIcon size={12} /> Warp to alarm
                  </WarpToButton>
                )
              )}
            </>
          ) : (
            <Quiet>No alarms set</Quiet>
          )}
        </Row>
        {(warpToCandidate || snap.warpTo !== null) && (
          <SafetyRow>
            <Label>Safety margin</Label>
            <SafetyInput
              type="number"
              min={MIN_WARP_SAFETY_MARGIN_SECONDS}
              max={MAX_WARP_SAFETY_MARGIN_SECONDS}
              step={1}
              value={snap.warpSafetyMarginSeconds}
              onChange={(e) => {
                const n = Number.parseFloat(e.target.value);
                if (Number.isFinite(n)) host.setWarpSafetyMargin(n);
              }}
              aria-label="Warp-to safety margin in real seconds"
            />
            <SafetyHint>
              real seconds before arming — higher = step down earlier
            </SafetyHint>
          </SafetyRow>
        )}
        {firedAlarms.length > 1 && (
          <FiredList>
            {firedAlarms
              .filter((a) => a.id !== nextAlarm?.id)
              .map((a) => (
                <FiredRow key={a.id}>
                  <FiredName>{a.name} fired</FiredName>
                  <AckButton
                    type="button"
                    onClick={() => host.acknowledgeAlarm(a.id)}
                  >
                    Ack
                  </AckButton>
                </FiredRow>
              ))}
          </FiredList>
        )}
        {snap.unscheduledWarp && (
          <WarnRow role="alert">
            <WarnLabel>
              Unscheduled warp — rate {snap.unscheduledWarp.index}× detected
            </WarnLabel>
            <AckButton
              type="button"
              onClick={() => host.acknowledgeUnscheduledWarp()}
            >
              Acknowledge
            </AckButton>
          </WarnRow>
        )}
      </Stack>
    </Wrap>
  );
}

function isWarpToCandidate(alarm: Alarm): boolean {
  if (alarm.trigger.kind === "time") return true;
  // Contract-parameter triggers are discrete state transitions — no
  // monotonic axis to warp toward.
  if (alarm.trigger.kind === "contract-parameter") return false;
  const op = alarm.trigger.op;
  return op !== "==" && op !== "!=";
}

type Tone = "idle" | "set" | "arm" | "fire";

function bannerTone(alarm: Alarm | null): Tone {
  if (!alarm) return "idle";
  if (alarm.state === "firing" || alarm.state === "fired") return "fire";
  if (alarm.state === "arming") return "arm";
  return "set";
}

function pickNext(snap: AlarmSnapshot): Alarm | null {
  // Prefer firing > fired > arming > pending. Fired alarms now stay in
  // the list until the user acks, so they need to outrank pending — a
  // pending time alarm in the future shouldn't hide a just-fired
  // telemetry alarm waiting for acknowledgement.
  const priority: Record<Alarm["state"], number> = {
    firing: 0,
    fired: 1,
    arming: 2,
    pending: 3,
  };
  const sortKey = (a: Alarm): number =>
    a.trigger.kind === "time" ? a.trigger.ut : Number.POSITIVE_INFINITY;
  const sorted = [...snap.alarms].sort((a, b) => {
    const p = priority[a.state] - priority[b.state];
    if (p !== 0) return p;
    // Time alarms sort by UT (earliest first); threshold alarms have no
    // single firing UT, so they fall to the end of the same-priority
    // group — surfaced only when there's nothing else competing.
    return sortKey(a) - sortKey(b);
  });
  return sorted[0] ?? null;
}

function formatNext(alarm: Alarm, utNow: number | null): string {
  if (alarm.trigger.kind === "time") {
    return formatTMinus(alarm.trigger.ut, utNow);
  }
  if (alarm.trigger.kind === "contract-parameter") {
    return `${alarm.trigger.parameterTitle} → ${alarm.trigger.targetState}`;
  }
  // Threshold — no single fire UT; show the condition compactly.
  const t = alarm.trigger;
  return `${t.dataKey} ${t.op} ${t.value}`;
}

function formatWarp(index: number, rate: number): string {
  // `rate` is the source of truth — Telemachus delivers it on every WS
  // frame. `index` may be unavailable in some KSP / Telemachus builds, so
  // never gate on `index === 0` (that would silently mask manual warp).
  if (!Number.isFinite(rate) || rate <= 0) {
    return Number.isFinite(index) ? `${index}×` : "—";
  }
  return formatRate(rate);
}

function formatRate(rate: number): string {
  if (rate < 1.0001) return "1×";
  if (rate >= 1000) return `${(rate / 1000).toFixed(rate >= 10_000 ? 0 : 1)}k×`;
  if (Number.isInteger(rate)) return `${rate}×`;
  return `${rate.toFixed(2)}×`;
}

function formatTMinus(utTarget: number, utNow: number | null): string {
  if (utNow === null) return "T−?";
  const delta = utTarget - utNow;
  if (delta <= 0) {
    if (delta > -3) return "T = 0";
    return `T+${formatSeconds(-delta)}`;
  }
  return `T−${formatSeconds(delta)}`;
}

function formatSeconds(s: number): string {
  if (s < 60) return `${s.toFixed(0)}s`;
  const m = Math.floor(s / 60);
  const sec = Math.round(s - m * 60);
  if (m < 60) return `${m}m ${sec.toString().padStart(2, "0")}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${(m - h * 60).toString().padStart(2, "0")}m`;
}

// ── Styles ────────────────────────────────────────────────────────────────────

const TONE_BG: Record<Tone, string> = {
  idle: "rgba(20, 20, 20, 0.85)",
  set: "rgba(25, 40, 20, 0.9)",
  arm: "rgba(60, 45, 15, 0.95)",
  fire: "rgba(90, 15, 15, 0.95)",
};
const TONE_BORDER: Record<Tone, string> = {
  idle: "var(--color-border-subtle)",
  set: "var(--color-status-go-bg)",
  arm: "var(--color-status-warning-bg)",
  fire: "var(--color-status-nogo-bg)",
};
const TONE_COUNT: Record<Tone, string> = {
  idle: "var(--color-text-muted)",
  set: "var(--color-status-go-fg)",
  arm: "var(--color-status-warning-bg)",
  fire: "var(--color-status-nogo-fg)",
};

const Wrap = styled.div<{ $tone: Tone }>`
  position: fixed;
  top: calc(8px + env(safe-area-inset-top, 0px));
  left: 50%;
  transform: translateX(-50%);
  z-index: 900;
  background: ${({ $tone }) => TONE_BG[$tone]};
  border: 1px solid ${({ $tone }) => TONE_BORDER[$tone]};
  border-radius: 3px;
  color: var(--color-text-primary);
  font-size: 12px;
  padding: 6px 12px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.55);
  pointer-events: auto;
  max-width: calc(100vw - 16px);
`;

const Stack = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const Row = styled.div`
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
`;

const Label = styled.span`
  font-size: var(--font-size-xs);
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--color-text-dim);
`;

const Value = styled.span`
  font-weight: 700;
  color: var(--color-text-primary);
`;

const Divider = styled.span`
  width: 1px;
  align-self: stretch;
  background: var(--color-border-strong);
  margin: 0 4px;
`;

const AlarmName = styled.span`
  color: var(--color-text-primary);
  font-weight: 600;
  max-width: 22em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const Countdown = styled.span<{ $tone: Tone }>`
  font-weight: 700;
  color: ${({ $tone }) => TONE_COUNT[$tone]};
  font-variant-numeric: tabular-nums;
`;

const Quiet = styled.span`
  color: var(--color-text-dim);
  font-style: italic;
`;

const FiredList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-top: 4px;
  border-top: 1px dashed var(--color-status-nogo-bg);
  margin-top: 2px;
`;

const FiredRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
`;

const FiredName = styled.span`
  color: var(--color-status-nogo-fg);
  font-weight: 600;
`;

const WarnRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding-top: 4px;
  border-top: 1px dashed var(--color-status-nogo-bg);
  margin-top: 2px;
`;

const WarnLabel = styled.span`
  color: var(--color-status-nogo-fg);
  font-weight: 600;
`;

const AckButton = styled.button`
  background: none;
  border: 1px solid var(--color-status-nogo-bg);
  color: var(--color-status-nogo-fg);
  font-size: var(--font-size-xs);
  padding: 2px 8px;
  border-radius: 2px;
  cursor: pointer;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  @media (hover: hover) {
    &:hover {
      background: var(--color-status-alert-muted);
    }
  }
`;

const WarpArrow = styled.span`
  color: var(--color-text-dim);
  display: inline-flex;
  align-items: center;
`;

const WarpToTarget = styled.span`
  font-weight: 700;
  color: var(--color-status-go-fg);
  font-variant-numeric: tabular-nums;
`;

const WarpToButton = styled.button`
  background: var(--color-status-go-bg);
  border: 1px solid var(--color-status-go-bg);
  color: var(--color-status-go-fg);
  font-size: var(--font-size-xs);
  padding: 2px 8px;
  border-radius: 2px;
  cursor: pointer;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  @media (hover: hover) {
    &:hover {
      filter: brightness(1.15);
    }
  }
  &:focus-visible {
    outline: 2px solid var(--color-accent-fg);
    outline-offset: 2px;
  }
`;

const StopWarpButton = styled.button`
  background: var(--color-status-warning-bg);
  border: 1px solid var(--color-status-warning-bg);
  color: var(--color-text-primary);
  font-size: var(--font-size-xs);
  padding: 2px 8px;
  border-radius: 2px;
  cursor: pointer;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  @media (hover: hover) {
    &:hover {
      filter: brightness(1.15);
    }
  }
  &:focus-visible {
    outline: 2px solid var(--color-accent-fg);
    outline-offset: 2px;
  }
`;

const SafetyRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding-top: 4px;
  border-top: 1px dashed var(--color-border-subtle);
  margin-top: 2px;
`;

const SafetyInput = styled.input`
  width: 4em;
  font-size: 12px;
  padding: 2px 4px;
  background: var(--color-surface-panel);
  color: var(--color-text-primary);
  border: 1px solid var(--color-border-subtle);
  border-radius: 2px;
  font-variant-numeric: tabular-nums;
  &:focus-visible {
    outline: 2px solid var(--color-accent-fg);
    outline-offset: 1px;
  }
`;

const SafetyHint = styled.span`
  color: var(--color-text-dim);
  font-size: var(--font-size-xs);
  font-style: italic;
`;
