import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type FakeOscillator,
  installFakeAudio,
  makeSoundService,
} from "../test/fakeAudio";
import { __resetSharedAudioContextForTests } from "./audio";
import {
  __resetSoundEnabledForTests,
  initSoundSettings,
  isSoundEnabled,
  playAbortTone,
  playCountdownTone,
  SOUND_ENABLED_SETTING,
} from "./index";

describe("sound settings gating", () => {
  let unsub: (() => void) | null = null;
  let oscillators: FakeOscillator[] = [];

  beforeEach(() => {
    // Drop the shared AudioContext singleton first so this test's fresh fake
    // isn't shadowed by a context captured in a previous case.
    __resetSharedAudioContextForTests();
    oscillators = installFakeAudio();
    __resetSoundEnabledForTests();
  });

  afterEach(() => {
    unsub?.();
    unsub = null;
    __resetSoundEnabledForTests();
  });

  it("defaults to ON", () => {
    expect(isSoundEnabled()).toBe(true);
  });

  it("does not create an oscillator when sound is disabled", () => {
    const svc = makeSoundService(false);
    unsub = initSoundSettings(svc);
    expect(isSoundEnabled()).toBe(false);

    playCountdownTone(false);
    playCountdownTone(true);
    playAbortTone();

    expect(oscillators).toHaveLength(0);
  });

  it("creates oscillators when sound is enabled", () => {
    const svc = makeSoundService(true);
    unsub = initSoundSettings(svc);
    expect(isSoundEnabled()).toBe(true);

    playCountdownTone(false);
    expect(oscillators.length).toBeGreaterThan(0);
  });

  it("uses a distinct (higher) frequency for the T-0 commit tone", () => {
    unsub = initSoundSettings(makeSoundService(true));

    playCountdownTone(false);
    const perSecondFreq = oscillators.at(-1)?.frequency.value ?? 0;

    playCountdownTone(true);
    const t0Freq = oscillators.at(-1)?.frequency.value ?? 0;

    expect(t0Freq).toBeGreaterThan(perSecondFreq);
  });

  it("reacts to a live setting change (subscription keeps the flag in sync)", () => {
    const svc = makeSoundService(true);
    unsub = initSoundSettings(svc);
    expect(isSoundEnabled()).toBe(true);

    svc.set(SOUND_ENABLED_SETTING, false);
    expect(isSoundEnabled()).toBe(false);

    playAbortTone();
    expect(oscillators).toHaveLength(0);
  });
});
