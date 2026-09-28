import { beforeEach, describe, expect, it, vi } from "vitest";
import { StationIdentityService } from "../stationIdentity/StationIdentityService";

function makeStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => Array.from(data.keys())[i] ?? null,
    removeItem: (k) => {
      data.delete(k);
    },
    setItem: (k, v) => {
      data.set(k, v);
    },
  };
}

describe("StationIdentityService", () => {
  let storage: Storage;

  beforeEach(() => {
    storage = makeStorage();
  });

  it("seeds a generated name on first run", () => {
    const svc = new StationIdentityService(storage);
    expect(svc.getName()).toMatch(/^Station [A-Z0-9]{4}$/);
    expect(storage.getItem("gonogo.station.name")).toBe(svc.getName());
  });

  it("preserves a saved name across instances", () => {
    storage.setItem("gonogo.station.name", "Capsule Komm");
    const svc = new StationIdentityService(storage);
    expect(svc.getName()).toBe("Capsule Komm");
  });

  it("does not read an old save-profile-scoped name: a device with only that gets a fresh one", () => {
    storage.setItem("gonogo.saveProfiles.active", "profile-A");
    storage.setItem("gonogo.station.name.profile-A", "Old Capcom");

    const svc = new StationIdentityService(storage);
    expect(svc.getName()).toMatch(/^Station [A-Z0-9]{4}$/);
    expect(storage.getItem("gonogo.station.name")).toBe(svc.getName());
  });

  it("setName persists, trims, and notifies listeners", () => {
    const svc = new StationIdentityService(storage);
    const spy = vi.fn();
    svc.onChange(spy);
    svc.setName("  CAPCOM  ");
    expect(svc.getName()).toBe("CAPCOM");
    expect(storage.getItem("gonogo.station.name")).toBe("CAPCOM");
    expect(spy).toHaveBeenCalledWith("CAPCOM");
  });

  it("ignores empty or unchanged names", () => {
    const svc = new StationIdentityService(storage);
    const original = svc.getName();
    const spy = vi.fn();
    svc.onChange(spy);
    svc.setName("");
    svc.setName("   ");
    svc.setName(original);
    expect(svc.getName()).toBe(original);
    expect(spy).not.toHaveBeenCalled();
  });
});
