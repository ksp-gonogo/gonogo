import type { SettingsService } from "../settings";
import { registerSetting } from "../settings";
import { getSharedAudioContext, pulse } from "./audio";

/**
 * Main-screen sound effects: the alarm chime, the per-second GO/NO-GO
 * countdown tone, and the abort alert. All of these are MAIN-ONLY — they
 * pair with on-screen visual cues (alarm banner, countdown banner, abort
 * banner) so audio is never the sole signal (a11y). Stations stay silent
 * to avoid a multi-tab cacophony.
 *
 * The setting registers as a boolean (default ON). A module-scoped flag
 * mirrors the persisted value so non-React call sites (`playAlarmTone`,
 * the countdown/abort tones) can gate cheaply without a hook. The flag is
 * primed + kept in sync by `initSoundSettings`, called once from MainScreen.
 */

export const SOUND_ENABLED_SETTING = "sound.enabled";

registerSetting({
  id: SOUND_ENABLED_SETTING,
  type: "boolean",
  label: "Sound effects",
  description:
    "Play the alarm chime, per-second launch countdown tones, and the abort alert on this main screen. Station screens stay silent regardless.",
  category: "Audio",
  defaultValue: true,
  screens: ["main"],
});

// Default ON, matching the setting's defaultValue. Before MainScreen primes
// this via initSoundSettings, the flag already reflects the intended default
// so a tone firing during early startup behaves correctly.
let soundEnabled = true;

/** Cheap synchronous gate for non-React sound call sites. */
export function isSoundEnabled(): boolean {
  return soundEnabled;
}

/**
 * Prime the module flag from the persisted setting and keep it in sync.
 * Call once from MainScreen; the returned unsubscribe detaches the
 * subscription (StrictMode cleanup). MAIN-ONLY by where it's wired — never
 * call this from StationScreen.
 */
export function initSoundSettings(service: SettingsService): () => void {
  soundEnabled = service.get<boolean>(SOUND_ENABLED_SETTING, true);
  return service.subscribe<boolean>(SOUND_ENABLED_SETTING, (value) => {
    soundEnabled = value;
  });
}

/** Test-only: reset the module flag to its default between cases. */
export function __resetSoundEnabledForTests(): void {
  soundEnabled = true;
}

/**
 * Per-second countdown blip. `final` (T-0) gets a distinct higher, slightly
 * longer tone so the operator can hear "we're committing" without watching
 * the banner. No-op when sound is disabled.
 */
export function playCountdownTone(final = false): void {
  if (!soundEnabled) return;
  const ctx = getSharedAudioContext();
  if (!ctx) return;
  const now = ctx.currentTime;
  if (final) {
    // T-0 — a brighter, marginally longer commit tone.
    pulse(ctx, 1320, now, 0.32, 0.2);
  } else {
    // Each second — a short, low blip.
    pulse(ctx, 660, now, 0.1, 0.14);
  }
}

/**
 * Short two-pulse descending alert fired once when an abort is triggered.
 * Distinct from the alarm chime (lower, sharper) so it reads as "abort"
 * rather than "alarm". No-op when sound is disabled.
 */
export function playAbortTone(): void {
  if (!soundEnabled) return;
  const ctx = getSharedAudioContext();
  if (!ctx) return;
  const now = ctx.currentTime;
  pulse(ctx, 440, now, 0.16, 0.22);
  pulse(ctx, 330, now + 0.18, 0.24, 0.22);
}
