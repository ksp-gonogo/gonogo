import { ArrowRightIcon, PlayIcon, StopIcon } from "@ksp-gonogo/ui";
import { useEffect, useState } from "react";
import styled from "styled-components";
import { useAlarmHost, useAlarmSnapshot } from "./AlarmHostContext";
import { useFireBeep } from "./alarmTone";
import { collapseFiredContractParam } from "./firedCollapse";
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

  const firedAlarms = snap.alarms.filter((a) => a.state === "fired");
  const cpCollapse = collapseFiredContractParam(firedAlarms);
  // Hide the individual contract-parameter fires from pickNext so a
  // pile of them doesn't dominate the banner. They surface together as
  // a collapsed "N completed" row instead.
  const collapsedIds = cpCollapse ? new Set(cpCollapse.ids) : null;
  const nextAlarm = pickNext(
    collapsedIds
      ? { ...snap, alarms: snap.alarms.filter((a) => !collapsedIds.has(a.id)) }
      : snap,
  );
  const tone = bannerTone(nextAlarm);

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

  // User feedback (2026-05-12): the warp/alarm banner used to be persistent
  // at the top of the viewport and clobbered top-row widgets. New rule —
  // only render when there's something to surface: warp ≠ 1×, an alarm is
  // pending/firing, or a warpTo plan is queued.
  const isQuiet =
    snap.warp.rate <= 1.0001 &&
    nextAlarm === null &&
    firedAlarms.length === 0 &&
    cpCollapse === null &&
    snap.warpTo === null;
  if (isQuiet) return null;

  const ackAllCollapsed = () => {
    if (!cpCollapse) return;
    for (const id of cpCollapse.ids) host.acknowledgeAlarm(id);
  };

  return (
    <Wrap $tone={tone} role={tone === "fire" ? "alert" : "status"}>
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
            <Label>{headlineLabel(nextAlarm.state)}</Label>
            <AlarmName>{nextAlarm.name}</AlarmName>
            {/* Only render the countdown text when it adds information
                beyond the alarm name. Threshold alarms used to render
                the trigger condition next to the name — but the user's
                name typically already encodes it ("latlong v.lat >= 80"),
                so we'd produce visible duplicates like "latlong v.lat
                >= 80  v.lat >= 80". Time alarms still get a T-minus,
                contract parameters still get the target-state label. */}
            {(() => {
              const next = formatNextLine(nextAlarm, snap.ut);
              return next === null ? null : (
                <Countdown $tone={tone}>{next}</Countdown>
              );
            })()}
            {(nextAlarm.state === "fired" || nextAlarm.state === "firing") && (
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
        ) : cpCollapse ? (
          <CollapsedCPInline
            count={cpCollapse.count}
            onAckAll={ackAllCollapsed}
          />
        ) : (
          <Quiet>No alarms set</Quiet>
        )}
      </Row>
    </Wrap>
  );
}

/**
 * Sibling pill that surfaces the warp-to safety margin as its own
 * single-row banner. Rendered only when a warp-to session is active
 * (or a candidate exists) — the operator only cares about the margin
 * when it's actively shaping behaviour. The hint moves to a `title`
 * tooltip so the pill stays one row tall like every other banner.
 */
export function SafetyMarginPill() {
  const snap = useAlarmSnapshot();
  const host = useAlarmHost();
  const nextAlarm = pickNext(snap);
  const warpToCandidate =
    nextAlarm && nextAlarm.state === "pending" && isWarpToCandidate(nextAlarm)
      ? nextAlarm
      : null;
  if (snap.warpTo === null && !warpToCandidate) return null;
  return (
    <Wrap $tone="set" role="status">
      <Row>
        <Label>Safety</Label>
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
          title="Real seconds before arming — higher = step down earlier"
        />
        <Label>s</Label>
      </Row>
    </Wrap>
  );
}

/**
 * One sibling pill per fired alarm not already represented in the
 * headline AlarmBanner. Contract-parameter fires collapse to a single
 * "N contract objectives completed" pill so a pile of them doesn't
 * crowd the stack. Each pill has its own Ack button — clicking
 * removes only that pill, leaving the others.
 */
export function FiredAlarmPills() {
  const snap = useAlarmSnapshot();
  const host = useAlarmHost();
  const firedAlarms = snap.alarms.filter((a) => a.state === "fired");
  const cpCollapse = collapseFiredContractParam(firedAlarms);
  const collapsedIds = cpCollapse ? new Set(cpCollapse.ids) : null;
  // Skip the alarm the headline AlarmBanner is already rendering so
  // we don't duplicate it as a sibling pill.
  const headline = pickNext(
    collapsedIds
      ? { ...snap, alarms: snap.alarms.filter((a) => !collapsedIds.has(a.id)) }
      : snap,
  );
  const extras = firedAlarms.filter(
    (a) => a.id !== headline?.id && !collapsedIds?.has(a.id),
  );
  const ackAllCollapsed = () => {
    if (!cpCollapse) return;
    for (const id of cpCollapse.ids) host.acknowledgeAlarm(id);
  };
  if (extras.length === 0 && (cpCollapse === null || headline === null)) {
    return null;
  }
  return (
    <>
      {extras.map((a) => (
        <Wrap key={a.id} $tone="fire" role="alert">
          <Row>
            <Label>Fired</Label>
            <AlarmName>{a.name}</AlarmName>
            <AckButton
              type="button"
              onClick={() => host.acknowledgeAlarm(a.id)}
            >
              Ack
            </AckButton>
          </Row>
        </Wrap>
      ))}
      {cpCollapse && headline !== null && (
        <Wrap $tone="fire" role="alert">
          <Row>
            <Label>Fired</Label>
            <AlarmName>
              {cpCollapse.count} contract objectives completed
            </AlarmName>
            <AckButton type="button" onClick={ackAllCollapsed}>
              Ack all
            </AckButton>
          </Row>
        </Wrap>
      )}
    </>
  );
}

/**
 * Sibling pill that surfaces an unscheduled warp change — KSP-side
 * warp wasn't triggered by an alarm or by the operator clicking the
 * banner's warp-to button. Stays distinct from the alarm pills so the
 * operator can ack it without affecting alarm state.
 */
export function UnscheduledWarpPill() {
  const snap = useAlarmSnapshot();
  const host = useAlarmHost();
  if (!snap.unscheduledWarp) return null;
  return (
    <Wrap $tone="arm" role="alert">
      <Row>
        <Label>Unscheduled warp</Label>
        <Value>{snap.unscheduledWarp.index}×</Value>
        <AckButton
          type="button"
          onClick={() => host.acknowledgeUnscheduledWarp()}
        >
          Ack
        </AckButton>
      </Row>
    </Wrap>
  );
}

function CollapsedCPInline({
  count,
  onAckAll,
}: {
  count: number;
  onAckAll: () => void;
}) {
  return (
    <>
      <Label>Fired</Label>
      <AlarmName>{count} contract objectives completed</AlarmName>
      <AckButton type="button" onClick={onAckAll}>
        Ack all
      </AckButton>
    </>
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

/** Headline label per alarm state. "Firing" / "Fired" carry the urgency
 *  word so an operator scanning the banner sees an active alert before
 *  reading the alarm name; "Arming" makes the imminent state explicit;
 *  "Next alarm" is the resting / pending case. */
function headlineLabel(state: Alarm["state"]): string {
  switch (state) {
    case "firing":
      return "Firing";
    case "fired":
      return "Fired";
    case "arming":
      return "Arming";
    default:
      return "Next alarm";
  }
}

/** Secondary text after the alarm name. Returns null when there's
 *  nothing useful to add — keeps the banner pill single-row and
 *  avoids redundant condition echoes.
 *
 *  Time alarms get a T-minus countdown (essential live info).
 *  Contract-parameter alarms get the parameter-title → target-state
 *  short form (the user's name is usually generic like "contract").
 *  Threshold alarms get nothing — the user's name almost always
 *  encodes the condition already ("latlong v.lat >= 80", "Pe < 70km"
 *  etc.) and rendering `dataKey op value` next to it just produces
 *  visible duplicates. Full condition stays one click away in the
 *  alarms modal. */
function formatNextLine(alarm: Alarm, utNow: number | null): string | null {
  if (alarm.trigger.kind === "time") {
    return formatTMinus(alarm.trigger.ut, utNow);
  }
  if (alarm.trigger.kind === "contract-parameter") {
    return `${alarm.trigger.parameterTitle} → ${alarm.trigger.targetState}`;
  }
  return null;
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

// Solid backgrounds — the previous 0.85-0.95 alphas let widgets behind
// the BannerStack bleed through as ghost text. Operator readability
// trumps the "see-through pill" aesthetic; the surface app colour
// matches the dashboard's app background so the pill still feels
// like part of the chrome rather than a hovering modal.
const TONE_BG: Record<Tone, string> = {
  idle: "var(--color-surface-raised)",
  set: "rgb(20, 35, 15)",
  arm: "rgb(55, 40, 12)",
  fire: "rgb(80, 12, 12)",
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
  background: ${({ $tone }) => TONE_BG[$tone]};
  border: 1px solid ${({ $tone }) => TONE_BORDER[$tone]};
  border-radius: 999px;
  color: var(--color-text-primary);
  font-size: 12px;
  padding: 8px 16px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.55);
  pointer-events: auto;
  max-width: 100%;
  animation: bannerSlideIn 320ms cubic-bezier(0.22, 1, 0.36, 1) forwards;
  transform-origin: right center;
  will-change: transform, opacity;

  @media (prefers-reduced-motion: reduce) {
    animation: none;
  }

  @keyframes bannerSlideIn {
    from {
      opacity: 0;
      transform: translateX(40px) scaleX(0.6);
    }
    60% {
      opacity: 1;
    }
    to {
      opacity: 1;
      transform: translateX(0) scaleX(1);
    }
  }
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
