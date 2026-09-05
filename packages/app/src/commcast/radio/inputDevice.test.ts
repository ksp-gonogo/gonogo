/**
 * The microphone choice, across page loads.
 *
 * Storage is the whole of this file's behaviour, and the cases worth asserting
 * are the ones that are not the happy path: a screen that has never chosen, a
 * key belonging to somebody else, and storage that refuses. Each has a safe
 * reading and each of them is "the browser's default", because a default input
 * exists on any machine with an input at all where a remembered id belongs to a
 * device that may since have been unplugged.
 */
import { describe, expect, it } from "vitest";
import { loadInputDevice, saveInputDevice } from "./inputDevice";

const KEY = "station-abc";

/** A `Storage` a test owns, so nothing here depends on the jsdom global. */
function memoryStorage(seed: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(seed));
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => {
      map.delete(k);
    },
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
  };
}

/** Storage that refuses, the shape private browsing and a full quota take. */
function refusingStorage(): Storage {
  const refuse = (): never => {
    throw new Error("refused");
  };
  return {
    length: 0,
    clear: refuse,
    getItem: refuse,
    key: refuse,
    removeItem: refuse,
    setItem: refuse,
  };
}

describe("the remembered microphone", () => {
  it("is the browser's default until one is chosen", () => {
    expect(loadInputDevice(KEY, memoryStorage())).toBeNull();
  });

  it("survives a reload", () => {
    const storage = memoryStorage();
    saveInputDevice(KEY, "headset-1", storage);
    expect(loadInputDevice(KEY, storage)).toBe("headset-1");
  });

  it("is per screen, because two tabs are two consoles", () => {
    // Keyed exactly as the monitor's mute exceptions are, and for the same
    // reason: two operators at one browser may well have two headsets.
    const storage = memoryStorage();
    saveInputDevice(KEY, "headset-1", storage);
    expect(loadInputDevice("station-xyz", storage)).toBeNull();
  });

  it("forgets rather than storing a null", () => {
    const storage = memoryStorage();
    saveInputDevice(KEY, "headset-1", storage);
    saveInputDevice(KEY, null, storage);
    expect(loadInputDevice(KEY, storage)).toBeNull();
    expect(storage.length).toBe(0);
  });

  it("reads an empty id as no choice", () => {
    /*
     * `enumerateDevices` uses the empty string for an entry naming nothing
     * openable, and a stored one would key the microphone against a constraint
     * no device satisfies.
     */
    const storage = memoryStorage({
      "gonogo.commcast.radio.input.v1.station-abc": "",
    });
    expect(loadInputDevice(KEY, storage)).toBeNull();
  });

  it("falls back to the default where storage refuses, and says nothing", () => {
    expect(() =>
      saveInputDevice(KEY, "headset-1", refusingStorage()),
    ).not.toThrow();
    expect(loadInputDevice(KEY, refusingStorage())).toBeNull();
  });
});
