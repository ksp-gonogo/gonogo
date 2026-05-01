import { useEffect, useRef } from "react";
import type { Alarm } from "./types";

/**
 * Play a short two-pulse tone whenever an alarm transitions into the
 * firing or fired state. Tracks ids that have already chimed so the 1Hz
 * banner tick doesn't repeat the tone for the same fire event. Ids drop
 * out of the tracker once acknowledged so the same alarm firing again
 * later still chimes.
 */
export function useFireBeep(alarms: readonly Alarm[]): void {
  // Seed from the initial alarms so a hot reload (or any other remount)
  // with a still-fired alarm in localStorage doesn't replay the chime.
  // Only ids that transition into firing/fired *after* mount should beep.
  const firedIdsRef = useRef<Set<string> | null>(null);
  if (firedIdsRef.current === null) {
    firedIdsRef.current = new Set(
      alarms
        .filter((a) => a.state === "firing" || a.state === "fired")
        .map((a) => a.id),
    );
  }
  useEffect(() => {
    const seen = firedIdsRef.current ?? new Set<string>();
    const justFired: string[] = [];
    const stillRelevant = new Set<string>();
    for (const a of alarms) {
      if (a.state === "firing" || a.state === "fired") {
        stillRelevant.add(a.id);
        if (!seen.has(a.id)) justFired.push(a.id);
      }
    }
    firedIdsRef.current = stillRelevant;
    if (justFired.length > 0) playAlarmTone();
  }, [alarms]);
}

let sharedAudioContext: AudioContext | null = null;
export function playAlarmTone(): void {
  if (typeof window === "undefined") return;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
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
