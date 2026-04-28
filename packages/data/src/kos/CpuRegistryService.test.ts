import { beforeEach, describe, expect, it, vi } from "vitest";
import { CpuRegistryService } from "./CpuRegistryService";

class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  clear(): void {
    this.map.clear();
  }
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  key(i: number): string | null {
    return [...this.map.keys()][i] ?? null;
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
}

describe("CpuRegistryService", () => {
  let storage: MemoryStorage;
  beforeEach(() => {
    storage = new MemoryStorage();
  });

  it("starts empty when storage has no entry for the screen", () => {
    const svc = new CpuRegistryService("main", storage);
    expect(svc.list()).toEqual([]);
  });

  it("upsert creates an entry and persists it", () => {
    const svc = new CpuRegistryService("main", storage);
    const entry = svc.upsert({
      tagname: "lander",
      label: "Lander Computer",
      description: "Mun lander brain",
    });
    expect(entry.tagname).toBe("lander");
    expect(entry.label).toBe("Lander Computer");
    expect(entry.description).toBe("Mun lander brain");
    expect(entry.createdAt).toBeGreaterThan(0);
    // Persisted JSON round-trips through a second instance.
    const reload = new CpuRegistryService("main", storage);
    expect(reload.list()).toHaveLength(1);
    expect(reload.list()[0]?.tagname).toBe("lander");
  });

  it("upsert on an existing tagname updates label/description and keeps createdAt", () => {
    const svc = new CpuRegistryService("main", storage);
    const a = svc.upsert({ tagname: "x", label: "old" });
    const b = svc.upsert({
      tagname: "x",
      label: "new",
      description: "fresh",
    });
    expect(b.tagname).toBe("x");
    expect(b.label).toBe("new");
    expect(b.description).toBe("fresh");
    expect(b.createdAt).toBe(a.createdAt);
    expect(svc.list()).toHaveLength(1);
  });

  it("upsert trims whitespace and empties become undefined", () => {
    const svc = new CpuRegistryService("main", storage);
    const e = svc.upsert({
      tagname: "  flight  ",
      label: "  ",
      description: "",
    });
    expect(e.tagname).toBe("flight");
    expect(e.label).toBeUndefined();
    expect(e.description).toBeUndefined();
  });

  it("upsert rejects an empty tagname", () => {
    const svc = new CpuRegistryService("main", storage);
    expect(() => svc.upsert({ tagname: "   " })).toThrow(/tagname/);
  });

  it("remove drops the entry by tagname", () => {
    const svc = new CpuRegistryService("main", storage);
    svc.upsert({ tagname: "a" });
    svc.upsert({ tagname: "b" });
    svc.remove("a");
    expect(svc.list().map((e) => e.tagname)).toEqual(["b"]);
  });

  it("markSeen creates a bare entry when the tagname is unknown", () => {
    const svc = new CpuRegistryService("main", storage);
    svc.markSeen("orbital", 1234);
    const e = svc.get("orbital");
    expect(e?.tagname).toBe("orbital");
    expect(e?.lastSeenAt).toBe(1234);
    expect(e?.createdAt).toBe(1234);
  });

  it("markSeen on an existing entry updates lastSeenAt only", () => {
    const svc = new CpuRegistryService("main", storage);
    const a = svc.upsert({ tagname: "x", label: "L" });
    svc.markSeen("x", 9999);
    const after = svc.get("x");
    expect(after?.label).toBe("L");
    expect(after?.lastSeenAt).toBe(9999);
    expect(after?.createdAt).toBe(a.createdAt);
  });

  it("reportSeen stamps multiple tagnames in one shot", () => {
    const svc = new CpuRegistryService("main", storage);
    svc.reportSeen(["a", "b", "c"], 5000);
    expect(
      svc
        .list()
        .map((e) => e.tagname)
        .sort(),
    ).toEqual(["a", "b", "c"]);
    for (const t of ["a", "b", "c"]) {
      expect(svc.get(t)?.lastSeenAt).toBe(5000);
    }
  });

  it("list sorts online entries (recent lastSeenAt) ahead of offline", () => {
    const svc = new CpuRegistryService("main", storage);
    svc.upsert({ tagname: "offline" });
    svc.markSeen("recent", 9999);
    svc.markSeen("older", 1000);
    const order = svc.list().map((e) => e.tagname);
    expect(order[0]).toBe("recent");
    expect(order[1]).toBe("older");
    expect(order[2]).toBe("offline");
  });

  it("storage is partitioned per screen", () => {
    const main = new CpuRegistryService("main", storage);
    const station = new CpuRegistryService("station", storage);
    main.upsert({ tagname: "main-only" });
    station.upsert({ tagname: "station-only" });
    expect(main.list().map((e) => e.tagname)).toEqual(["main-only"]);
    expect(station.list().map((e) => e.tagname)).toEqual(["station-only"]);
  });

  it("subscribe fires on upsert/remove/markSeen", () => {
    const svc = new CpuRegistryService("main", storage);
    const cb = vi.fn();
    const unsub = svc.subscribe(cb);
    svc.upsert({ tagname: "a" });
    svc.markSeen("a");
    svc.remove("a");
    expect(cb).toHaveBeenCalledTimes(3);
    unsub();
    svc.upsert({ tagname: "b" });
    expect(cb).toHaveBeenCalledTimes(3);
  });

  it("recovers from corrupt JSON in storage", () => {
    storage.setItem("gonogo.kos.cpus.main", "{not json");
    const svc = new CpuRegistryService("main", storage);
    expect(svc.list()).toEqual([]);
    // Corrupt key was cleared, not left in place.
    expect(storage.getItem("gonogo.kos.cpus.main")).toBeNull();
  });

  it("filters non-entry shapes out on load", () => {
    storage.setItem(
      "gonogo.kos.cpus.main",
      JSON.stringify([
        { tagname: "good", createdAt: 1 },
        { tagname: "missing-createdAt" },
        { not: "an entry" },
        null,
      ]),
    );
    const svc = new CpuRegistryService("main", storage);
    expect(svc.list().map((e) => e.tagname)).toEqual(["good"]);
  });
});
