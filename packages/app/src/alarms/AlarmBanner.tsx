import { useEffect, useRef, useState } from "react";
import styled from "styled-components";
import { useAlarmHost, useAlarmSnapshot } from "./AlarmHostContext";
import type { Alarm, AlarmSnapshot } from "./types";

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
          <Divider />
          {nextAlarm ? (
            <>
              <Label>{nextAlarm.state === "fired" ? "Fired" : "Next alarm"}</Label>
              <AlarmName>{nextAlarm.name}</AlarmName>
              <Countdown $tone={tone}>{formatNext(nextAlarm, snap.ut)}</Countdown>
              {nextAlarm.state === "fired" && (
                <AckButton
                  type="button"
                  onClick={() => host.acknowledgeAlarm(nextAlarm.id)}
                >
                  Acknowledge
                </AckButton>
              )}
            </>
          ) : (
            <Quiet>No alarms set</Quiet>
          )}
        </Row>
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

/**
 * Play a short tone whenever an alarm transitions into the firing or
 * fired state. We track ids that have already chimed so the 1Hz banner
 * tick doesn't repeat the tone for the same fire event.
 */
function useFireBeep(alarms: readonly Alarm[]): void {
  const firedIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const justFired: string[] = [];
    const stillRelevant = new Set<string>();
    for (const a of alarms) {
      if (a.state === "firing" || a.state === "fired") {
        stillRelevant.add(a.id);
        if (!firedIdsRef.current.has(a.id)) justFired.push(a.id);
      }
    }
    // Drop ids of alarms that were ack'd / removed so the same id firing
    // again later still chimes.
    firedIdsRef.current = stillRelevant;
    if (justFired.length > 0) playAlarmTone();
  }, [alarms]);
}

let sharedAudioContext: AudioContext | null = null;
function playAlarmTone(): void {
  // Web Audio is the simplest path that doesn't ship an audio asset.
  // Two short pulses at different pitches read as "alarm" without being
  // mistaken for a notification ping.
  if (typeof window === "undefined") return;
  const Ctor =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return;
  try {
    if (!sharedAudioContext) sharedAudioContext = new Ctor();
    const ctx = sharedAudioContext;
    if (ctx.state === "suspended") void ctx.resume();
    const now = ctx.currentTime;
    pulse(ctx, 880, now, 0.18);
    pulse(ctx, 660, now + 0.22, 0.22);
  } catch {
    // Audio might be blocked by autoplay policy on first load — silently
    // skip; the visual banner still alerts the operator.
  }
}

function pulse(
  ctx: AudioContext,
  freq: number,
  start: number,
  durationS: number,
): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "square";
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(0.18, start + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + durationS);
  osc.connect(gain).connect(ctx.destination);
  osc.start(start);
  osc.stop(start + durationS + 0.05);
}

function formatNext(alarm: Alarm, utNow: number | null): string {
  if (alarm.trigger.kind === "time") {
    return formatTMinus(alarm.trigger.ut, utNow);
  }
  // Threshold alarm — no single fire UT; show the condition compactly.
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
  idle: "#2a2a2a",
  set: "#3a5a3a",
  arm: "#ffae42",
  fire: "#ff4d4d",
};
const TONE_COUNT: Record<Tone, string> = {
  idle: "#888",
  set: "#cfe",
  arm: "#ffae42",
  fire: "#ffdede",
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
  color: #ccc;
  font-family: monospace;
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
  font-size: 9px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: #666;
`;

const Value = styled.span`
  font-weight: 700;
  color: #e8e8e8;
`;

const Divider = styled.span`
  width: 1px;
  align-self: stretch;
  background: #333;
  margin: 0 4px;
`;

const AlarmName = styled.span`
  color: #ccc;
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
  color: #666;
  font-style: italic;
`;

const FiredList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-top: 4px;
  border-top: 1px dashed #ff4d4d;
  margin-top: 2px;
`;

const FiredRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
`;

const FiredName = styled.span`
  color: #ffdede;
  font-weight: 600;
`;

const WarnRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding-top: 4px;
  border-top: 1px dashed #ff4d4d;
  margin-top: 2px;
`;

const WarnLabel = styled.span`
  color: #ffdede;
  font-weight: 600;
`;

const AckButton = styled.button`
  background: none;
  border: 1px solid #ff4d4d;
  color: #ffdede;
  font-family: monospace;
  font-size: 10px;
  padding: 2px 8px;
  border-radius: 2px;
  cursor: pointer;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  @media (hover: hover) {
    &:hover {
      background: #3a0a0a;
    }
  }
`;
