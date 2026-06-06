/**
 * Low-level Web Audio helpers shared by the alarm chime and the GO/NO-GO
 * countdown/abort tones. Deliberately free of any settings import so the
 * gating layer (soundSettings.ts) can import these without a cycle.
 *
 * A single shared AudioContext is reused across every tone so the browser
 * doesn't accumulate contexts (browsers cap the number you can create).
 */

let sharedAudioContext: AudioContext | null = null;

/**
 * Lazily create (and resume) the shared AudioContext. Returns null when
 * Web Audio is unavailable (SSR, jsdom without a fake, or a browser that
 * exposes neither `AudioContext` nor `webkitAudioContext`).
 */
export function getSharedAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctor) return null;
  try {
    if (!sharedAudioContext) sharedAudioContext = new Ctor();
    if (sharedAudioContext.state === "suspended") {
      void sharedAudioContext.resume();
    }
    return sharedAudioContext;
  } catch {
    // Autoplay policy or context-limit error — caller treats null as
    // "no audio right now"; the paired visual cue still alerts the operator.
    return null;
  }
}

/** Test-only: drop the cached context so a fresh fake AudioContext takes. */
export function __resetSharedAudioContextForTests(): void {
  sharedAudioContext = null;
}

/**
 * Play a single short square-wave pulse with a soft attack/decay envelope
 * so it reads as a clean blip rather than a click. `start` is an absolute
 * AudioContext time (use `ctx.currentTime` for "now").
 */
export function pulse(
  ctx: AudioContext,
  freq: number,
  start: number,
  durationS: number,
  peakGain = 0.18,
): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "square";
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(peakGain, start + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + durationS);
  osc.connect(gain).connect(ctx.destination);
  osc.start(start);
  osc.stop(start + durationS + 0.05);
}
