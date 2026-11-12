import { getSharedAudioContext, pulse } from "../sound";

/**
 * A short rising two-note chime for a text message that has arrived from
 * someone else. Useful for telling the operator a message landed while they
 * were looking at another thread or another widget. Used by Commcast.
 *
 * Silent, and never an error, while the browser has not yet let this page play
 * audio: a chime queued on a suspended context would sound late, at the first
 * click, for a message that is long read.
 */
export function playMessageChime(): void {
  const ctx = getSharedAudioContext();
  if (!ctx || ctx.state !== "running") return;
  const now = ctx.currentTime;
  pulse(ctx, 740, now, 0.09, 0.1);
  pulse(ctx, 988, now + 0.11, 0.14, 0.1);
}
