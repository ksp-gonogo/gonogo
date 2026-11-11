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

  it("keeps a name per seat, so a pilot page and the main screen in one browser do not share one", () => {
    const main = new StationIdentityService(storage, "Mission Control");
    const pilot = new StationIdentityService(storage, "Pilot", "pilot");
    pilot.setName("MKI");
    expect(storage.getItem("gonogo.station.name.pilot")).toBe("MKI");
    expect(main.getName()).toBe("Mission Control");
    expect(
      new StationIdentityService(storage, "Mission Control").getName(),
    ).toBe("Mission Control");
  });

  it("does not store the name a device starts with, so it can follow where the screen sits", () => {
    const svc = new StationIdentityService(storage, "Mission Control");
    expect(svc.getName()).toBe("Mission Control");
    expect(svc.getExplicitName()).toBeUndefined();
    expect(storage.getItem("gonogo.station.name")).toBeNull();
  });

  it("calls a name an operator typed explicit, even when it matches the starting name", () => {
    const svc = new StationIdentityService(storage, "Mission Control");
    svc.setName("Mission Control");
    expect(svc.getExplicitName()).toBe("Mission Control");
    expect(storage.getItem("gonogo.station.name")).toBe("Mission Control");
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
