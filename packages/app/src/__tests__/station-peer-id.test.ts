import { describe, expect, it } from "vitest";
import {
  clearStationKey,
  getStationKey,
  getStationPeerId,
} from "../peer/stationPeerId";

function makeStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => {
      store.set(k, v);
    },
    removeItem: (k) => {
      store.delete(k);
    },
    clear: () => store.clear(),
    key: () => null,
    get length() {
      return store.size;
    },
  } satisfies Storage;
}

describe("stationKey", () => {
  it("generates and persists a stable key on first call", () => {
    const storage = makeStorage();
    const first = getStationKey(storage);
    const second = getStationKey(storage);
    expect(first).toBe(second);
  });

  it("clearStationKey wipes the persisted id", () => {
    const storage = makeStorage();
    const first = getStationKey(storage);
    clearStationKey(storage);
    const second = getStationKey(storage);
    expect(second).not.toBe(first);
  });

  it("migrates the legacy persisted peer id forward as the new stationKey", () => {
    const storage = makeStorage();
    storage.setItem("gonogo.station.peer-id", "station-legacy-uuid");
    const key = getStationKey(storage);
    expect(key).toBe("legacy-uuid");
    expect(storage.getItem("gonogo.station.peer-id")).toBeNull();
    expect(storage.getItem("gonogo.station.key")).toBe("legacy-uuid");
  });
});

describe("stationPeerId (per-session)", () => {
  it("includes the persistent stationKey so it's stable identity-wise", () => {
    const storage = makeStorage();
    const key = getStationKey(storage);
    const peerId = getStationPeerId(storage);
    expect(peerId.startsWith(`station-${key}-`)).toBe(true);
  });

  it("returns a fresh per-session id every call", () => {
    const storage = makeStorage();
    const first = getStationPeerId(storage);
    const second = getStationPeerId(storage);
    expect(first).not.toBe(second);
    // ...but both share the same stationKey prefix.
    const key = getStationKey(storage);
    expect(first.startsWith(`station-${key}-`)).toBe(true);
    expect(second.startsWith(`station-${key}-`)).toBe(true);
  });
});
