import type { DataKey } from "@gonogo/core";
import { MockDataSource } from "@gonogo/core";
import { describe, expect, it, vi } from "vitest";
import { DataSourceWrapper } from "./DataSourceWrapper";
import { KeyedListenerSet, ListenerSet } from "./ListenerSet";

class PassthroughWrapper extends DataSourceWrapper {}

const KEYS: DataKey[] = [{ key: "v.altitude" }, { key: "v.surfaceSpeed" }];

describe("DataSourceWrapper", () => {
  it("forwards id and name when no overrides are given", () => {
    const real = new MockDataSource({ id: "src", name: "Source", keys: KEYS });
    const w = new PassthroughWrapper(real);
    expect(w.id).toBe("src");
    expect(w.name).toBe("Source");
  });

  it("honours id/name overrides from constructor opts", () => {
    const real = new MockDataSource({ id: "src", name: "Source", keys: KEYS });
    const w = new PassthroughWrapper(real, { id: "data", name: "Buffered" });
    expect(w.id).toBe("data");
    expect(w.name).toBe("Buffered");
  });

  it("forwards status via getter so it tracks upstream changes", () => {
    const real = new MockDataSource({ keys: KEYS });
    const w = new PassthroughWrapper(real);
    expect(w.status).toBe("disconnected");
    real.setStatus("connected");
    expect(w.status).toBe("connected");
  });

  it("forwards connect, disconnect, schema, and execute", async () => {
    const onExecute = vi.fn();
    const real = new MockDataSource({ keys: KEYS, onExecute });
    const connect = vi.spyOn(real, "connect");
    const disconnect = vi.spyOn(real, "disconnect");

    const w = new PassthroughWrapper(real);
    await w.connect();
    expect(connect).toHaveBeenCalledTimes(1);
    expect(w.schema()).toEqual(KEYS);

    await w.execute("a.do");
    expect(onExecute).toHaveBeenCalledWith("a.do");

    w.disconnect();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it("forwards configSchema, configure, and getConfig", () => {
    const real = new MockDataSource({ keys: KEYS });
    const configure = vi.spyOn(real, "configure");
    const w = new PassthroughWrapper(real);
    expect(w.configSchema()).toEqual([]);
    w.configure({ host: "kerbin" });
    expect(configure).toHaveBeenCalledWith({ host: "kerbin" });
    expect(w.getConfig()).toEqual({});
  });

  it("forwards subscribe to upstream by default", () => {
    const real = new MockDataSource({ keys: KEYS });
    const w = new PassthroughWrapper(real);
    const spy = vi.fn();
    const unsub = w.subscribe("v.altitude", spy);
    real.emit("v.altitude", 42);
    expect(spy).toHaveBeenCalledWith(42);
    unsub();
    real.emit("v.altitude", 43);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("forwards onStatusChange to upstream by default", () => {
    const real = new MockDataSource({ keys: KEYS });
    const w = new PassthroughWrapper(real);
    const spy = vi.fn();
    w.onStatusChange(spy);
    real.setStatus("connected");
    expect(spy).toHaveBeenCalledWith("connected");
  });

  it("returns null from setupInstructions when upstream lacks it", () => {
    const real = new MockDataSource({ keys: KEYS });
    const w = new PassthroughWrapper(real);
    expect(w.setupInstructions()).toBeNull();
  });

  it("allows subclasses to override subscribe with their own state", () => {
    class CountingWrapper extends DataSourceWrapper {
      readonly subs = new Set<(v: unknown) => void>();
      override subscribe(_key: string, cb: (v: unknown) => void): () => void {
        this.subs.add(cb);
        return () => {
          this.subs.delete(cb);
        };
      }
    }
    const real = new MockDataSource({ keys: KEYS });
    const w = new CountingWrapper(real);
    const cb = vi.fn();
    const unsub = w.subscribe("v.altitude", cb);
    expect(w.subs.size).toBe(1);
    unsub();
    expect(w.subs.size).toBe(0);
  });
});

describe("ListenerSet", () => {
  it("fires listeners and supports cleanup", () => {
    const set = new ListenerSet<[number]>();
    const a = vi.fn();
    const b = vi.fn();
    const removeA = set.add(a);
    set.add(b);
    expect(set.size).toBe(2);
    set.fire(7);
    expect(a).toHaveBeenCalledWith(7);
    expect(b).toHaveBeenCalledWith(7);
    removeA();
    expect(set.size).toBe(1);
    set.fire(8);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(2);
  });

  it("clears all listeners", () => {
    const set = new ListenerSet();
    set.add(() => {});
    set.add(() => {});
    set.clear();
    expect(set.size).toBe(0);
  });
});

describe("KeyedListenerSet", () => {
  it("routes by key and removes empty buckets", () => {
    const ks = new KeyedListenerSet<[unknown]>();
    const altSpy = vi.fn();
    const speedSpy = vi.fn();
    const removeAlt = ks.add("v.altitude", altSpy);
    ks.add("v.surfaceSpeed", speedSpy);

    ks.fire("v.altitude", 100);
    expect(altSpy).toHaveBeenCalledWith(100);
    expect(speedSpy).not.toHaveBeenCalled();

    expect(ks.has("v.altitude")).toBe(true);
    removeAlt();
    expect(ks.has("v.altitude")).toBe(false);
    expect(ks.size("v.altitude")).toBe(0);
  });
});
