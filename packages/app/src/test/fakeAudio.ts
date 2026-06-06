import { vi } from "vitest";
import { SettingsService } from "../settings";
import { SOUND_ENABLED_SETTING } from "../sound/soundSettings";

/**
 * Test helper: a fake Web Audio context for the sound tests. jsdom ships no
 * `AudioContext`, so `getSharedAudioContext` would return null and every tone
 * would be a silent no-op — a "no tone fired" assertion would then pass
 * vacuously. Installing this fake makes oscillator creation observable, which
 * is what discriminates the gating / station-silent cases.
 *
 * Returns the live `oscillators` array; each entry records the type + final
 * frequency the tone code set, so a test can assert "a tone fired" and even
 * "T-0 used a higher pitch".
 */
export interface FakeOscillator {
  type: string;
  frequency: { value: number };
  connect: () => { connect: () => void };
  start: () => void;
  stop: () => void;
}

export function installFakeAudio(): FakeOscillator[] {
  const oscillators: FakeOscillator[] = [];
  const makeOscillator = (): FakeOscillator => {
    const osc: FakeOscillator = {
      type: "",
      frequency: { value: 0 },
      connect: () => ({ connect: () => {} }),
      start: () => {},
      stop: () => {},
    };
    oscillators.push(osc);
    return osc;
  };
  // Must be a real constructor — getSharedAudioContext does `new Ctor()`,
  // and an arrow / vi.fn() factory is not newable.
  class FakeAudioContext {
    state = "running" as const;
    currentTime = 0;
    resume = vi.fn();
    createOscillator = makeOscillator;
    createGain = () => ({
      gain: {
        setValueAtTime: () => {},
        exponentialRampToValueAtTime: () => {},
      },
      connect: () => ({ connect: () => {} }),
    });
    destination = {};
  }
  (window as unknown as { AudioContext: unknown }).AudioContext =
    FakeAudioContext;
  return oscillators;
}

/** In-memory Storage so settings cases don't leak across tests. */
class MemoryStorage implements Storage {
  private m = new Map<string, string>();
  get length() {
    return this.m.size;
  }
  clear() {
    this.m.clear();
  }
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  key(i: number) {
    return [...this.m.keys()][i] ?? null;
  }
}

/**
 * A real SettingsService (no mocks) backed by isolated in-memory storage,
 * pre-seeded with the sound.enabled value. Pair with `initSoundSettings`.
 */
export function makeSoundService(enabled: boolean): SettingsService {
  const svc = new SettingsService(new MemoryStorage());
  svc.set(SOUND_ENABLED_SETTING, enabled);
  return svc;
}
