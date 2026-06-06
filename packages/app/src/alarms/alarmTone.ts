import { useEffect, useRef } from "react";
import { getSharedAudioContext, isSoundEnabled, pulse } from "../sound";
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

export function playAlarmTone(): void {
  // MAIN-ONLY + gated: stations never call this (no useFireBeep), and the
  // operator can mute via the "Sound effects" setting. The visual banner
  // still alerts regardless of audio.
  if (!isSoundEnabled()) return;
  const ctx = getSharedAudioContext();
  if (!ctx) return;
  const now = ctx.currentTime;
  pulse(ctx, 880, now, 0.18);
  pulse(ctx, 660, now + 0.22, 0.22);
}
