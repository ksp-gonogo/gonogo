import { value } from "@ksp-gonogo/sitrep-sdk";
import { Unit } from "@ksp-gonogo/ui-kit";
import { useEffect, useReducer, useRef, useState } from "react";
import styled from "styled-components";
import { playCountdownTone } from "../sound";
import { secondsUntil } from "./countdownClock";

/** Seconds left until `t0Ms`, re-rendering at 10 Hz while a countdown runs, or `null` with none. */
export function useSecondsLeft(t0Ms: number | null): number | null {
  const [, tick] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (t0Ms === null) return;
    const id = setInterval(tick, 100);
    return () => clearInterval(id);
  }, [t0Ms]);
  return t0Ms === null ? null : secondsUntil(t0Ms, Date.now());
}

/**
 * The running countdown as one line, "Stage in T − 7.3 s", with the action
 * left out when nothing fires at T-0.
 */
export function CountdownLine({
  secondsLeft,
  action,
}: Readonly<{ secondsLeft: number; action: string | null }>) {
  return (
    <Line role="timer" aria-label="Countdown">
      {action !== null && <Action>{action} in </Action>}T −{" "}
      <Unit value={value("s", secondsLeft)} decimals={1} />
    </Line>
  );
}

const Line = styled.span`
  display: inline-flex;
  align-items: baseline;
  gap: var(--gap-related);
  font-size: var(--font-size-figure);
  font-weight: 700;
  letter-spacing: 0.1em;
  color: var(--color-warn-text);
  white-space: nowrap;
`;

const Action = styled.span`
  font-size: var(--font-size-caption);
  font-weight: 400;
  letter-spacing: 0.12em;
  white-space: pre;
`;

/**
 * Announces countdown milestones to assistive tech without flooding the
 * screen reader every tick. Fires polite announcements at T-10, T-5, T-3,
 * T-2, T-1, and T-0.
 */
const MILESTONES = new Set([10, 5, 3, 2, 1, 0]);

export function CountdownAnnouncer({
  secondsLeft,
}: Readonly<{ secondsLeft: number }>) {
  const [message, setMessage] = useState("");
  const lastMilestoneRef = useRef<number | null>(null);

  useEffect(() => {
    const whole = Math.ceil(secondsLeft);
    if (!MILESTONES.has(whole)) return;
    if (lastMilestoneRef.current === whole) return;
    lastMilestoneRef.current = whole;
    setMessage(whole === 0 ? "T zero" : `T minus ${whole}`);
  }, [secondsLeft]);

  return (
    <span className="sr-only" role="status" aria-live="polite">
      {message}
    </span>
  );
}

/**
 * Fires a short audio blip on each whole-second countdown tick (T-9...T-1),
 * gated by the "Sound effects" setting inside `playCountdownTone`. The T-0
 * commit tone is the host service's, since the countdown clears the instant it
 * is reached and this would never observe zero. Main screen only, and always
 * beside the drawn countdown so sound is never the only cue.
 */
export function CountdownTone({
  secondsLeft,
}: Readonly<{ secondsLeft: number }>) {
  const lastWholeRef = useRef<number | null>(null);

  useEffect(() => {
    const whole = Math.ceil(secondsLeft);
    if (lastWholeRef.current === whole) return;
    // Skip the first observed value so mounting mid-countdown (a hot reload) fires no blip for whatever second it lands on.
    const isFirst = lastWholeRef.current === null;
    lastWholeRef.current = whole;
    if (isFirst || whole === 0) return;
    playCountdownTone(false);
  }, [secondsLeft]);

  return null;
}
