import { DashboardItemContext, ScreenProvider } from "@gonogo/core";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PeerClientProvider } from "../peer/PeerClientContext";
import type { PeerClientService } from "../peer/PeerClientService";
import type { SettingsService } from "../settings";
import { __resetSharedAudioContextForTests } from "../sound/audio";
import {
  __resetSoundEnabledForTests,
  initSoundSettings,
} from "../sound/soundSettings";
import {
  type FakeOscillator,
  installFakeAudio,
  makeSoundService,
} from "../test/fakeAudio";
import { CountdownTone, GoNoGoComponent } from "./GoNoGoComponent";

/**
 * Minimal PeerClient stand-in: only the methods StationView calls. The
 * countdown-start emitter lets us drive a station-side countdown without a
 * real peer connection.
 */
function makeFakeClient() {
  let startCb: ((t0Ms: number) => void) | null = null;
  const noop = () => () => {};
  const client = {
    sendGonogoVote: vi.fn(),
    sendGonogoAbort: vi.fn(),
    onGonogoCountdownStart: (cb: (t0Ms: number) => void) => {
      startCb = cb;
      return () => {
        startCb = null;
      };
    },
    onGonogoCountdownCancel: noop,
    onGonogoAbortNotify: noop,
    onHostHello: noop,
    onHostRestart: noop,
  } as unknown as PeerClientService;
  return { client, startCountdown: (t0Ms: number) => startCb?.(t0Ms) };
}

describe("GO/NO-GO sounds", () => {
  let unsub: (() => void) | null = null;
  let soundSvc: SettingsService | null = null;
  let oscillators: FakeOscillator[] = [];

  function useSound(enabled: boolean): void {
    unsub?.();
    soundSvc?.dispose();
    soundSvc = makeSoundService(enabled);
    unsub = initSoundSettings(soundSvc);
  }

  beforeEach(() => {
    vi.useFakeTimers();
    __resetSharedAudioContextForTests();
    oscillators = installFakeAudio();
    __resetSoundEnabledForTests();
    useSound(true);
  });

  afterEach(() => {
    cleanup();
    unsub?.();
    unsub = null;
    soundSvc?.dispose();
    soundSvc = null;
    __resetSoundEnabledForTests();
    vi.useRealTimers();
  });

  it("CountdownTone blips on each whole-second tick (main path)", () => {
    const { rerender } = render(<CountdownTone secondsLeft={9.4} />);
    // First observed value is skipped (mount mid-countdown guard).
    expect(oscillators).toHaveLength(0);

    rerender(<CountdownTone secondsLeft={8.6} />);
    expect(oscillators).toHaveLength(1);

    // Sub-second ticks within the same whole second don't re-fire.
    rerender(<CountdownTone secondsLeft={8.1} />);
    expect(oscillators).toHaveLength(1);

    rerender(<CountdownTone secondsLeft={7.5} />);
    expect(oscillators).toHaveLength(2);
  });

  it("does not blip when sound is disabled", () => {
    useSound(false);
    const { rerender } = render(<CountdownTone secondsLeft={9.4} />);
    rerender(<CountdownTone secondsLeft={8.6} />);
    rerender(<CountdownTone secondsLeft={7.5} />);
    expect(oscillators).toHaveLength(0);
  });

  it("station screen stays silent during a countdown", () => {
    const { client, startCountdown } = makeFakeClient();
    render(
      <ScreenProvider value="station">
        <DashboardItemContext.Provider value={{ instanceId: "gonogo-1" }}>
          <PeerClientProvider client={client}>
            <GoNoGoComponent id="gonogo-1" config={{}} w={4} h={4} />
          </PeerClientProvider>
        </DashboardItemContext.Provider>
      </ScreenProvider>,
    );

    // Drive a station-side countdown and let the 100ms ticker run through it.
    act(() => {
      startCountdown(Date.now() + 5_000);
    });
    act(() => {
      vi.advanceTimersByTime(6_000);
    });

    // StationView renders neither CountdownTone nor any host tone — silence
    // is structural, not just gated.
    expect(oscillators).toHaveLength(0);
  });
});
