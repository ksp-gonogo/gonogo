import { afterEach, describe, expect, it, vi } from "vitest";
import { getStationPeerId } from "./stationPeerId";

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  } as Storage;
}

describe("getStationPeerId on an origin without crypto.randomUUID", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("is shaped like the station ids the log scrubber masks", () => {
    vi.stubGlobal("crypto", {
      getRandomValues: globalThis.crypto.getRandomValues.bind(
        globalThis.crypto,
      ),
    });

    expect(getStationPeerId(memoryStorage())).toMatch(
      /^station-[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}-\w+$/,
    );
  });
});
