import { ScreenProvider } from "@ksp-gonogo/core";
import { SerialDeviceProvider, SerialDeviceService } from "@ksp-gonogo/serial";
import { act, render } from "@ksp-gonogo/test-utils";
import { ModalProvider } from "@ksp-gonogo/ui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type PeerClient, PeerClientProvider } from "../peer/PeerClientContext";
import type { SettingsService } from "../settings";
import { __resetSharedAudioContextForTests } from "../sound/audio";
import {
  __resetSoundEnabledForTests,
  initSoundSettings,
} from "../sound/soundSettings";
import {
  StationIdentityProvider,
  StationIdentityService,
} from "../stationIdentity";
import {
  type FakeOscillator,
  installFakeAudio,
  makeSoundService,
} from "../test/fakeAudio";
import { idlePeerClient } from "../test/peerFakes";
import { CountdownTone } from "./countdownCues";
import { StationPollControl } from "./StationPollControl";

/**
 * A station link whose countdown-start emitter the test drives, so a
 * station-side countdown runs without a real peer connection.
 */
function makeFakeClient() {
  let startCb: ((t0Ms: number) => void) | null = null;
  const client: PeerClient = {
    ...idlePeerClient(),
    sendGonogoVote: vi.fn(),
    sendGonogoAbort: vi.fn(),
    onGonogoCountdownStart: (cb: (t0Ms: number) => void) => {
      startCb = cb;
      return () => {
        startCb = null;
      };
    },
  };
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
        <ModalProvider>
          <SerialDeviceProvider
            service={new SerialDeviceService({ screenKey: "station" })}
          >
            <StationIdentityProvider service={new StationIdentityService()}>
              <PeerClientProvider client={client}>
                <StationPollControl />
              </PeerClientProvider>
            </StationIdentityProvider>
          </SerialDeviceProvider>
        </ModalProvider>
      </ScreenProvider>,
    );

    // Drive a station-side countdown and let the 100ms ticker run through it.
    act(() => {
      startCountdown(Date.now() + 5_000);
    });
    act(() => {
      vi.advanceTimersByTime(6_000);
    });

    // A station draws neither CountdownTone nor any host tone, so its silence is structural, not just gated.
    expect(oscillators).toHaveLength(0);
  });
});
