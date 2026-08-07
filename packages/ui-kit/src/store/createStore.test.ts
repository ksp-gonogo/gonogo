import { describe, expect, it, vi } from "vitest";
import { createStore } from "./createStore";

interface Entry {
  id: string;
  value: number;
}

describe("createStore", () => {
  it("is empty with a stable empty snapshot and no entries", () => {
    const store = createStore<Entry>();
    expect(store.getSnapshot()).toEqual([]);
    // Stable empty identity: a fresh `[]` each call would make
    // useSyncExternalStore believe the snapshot changed and loop forever.
    expect(store.getSnapshot()).toBe(store.getSnapshot());
  });

  it("register adds an entry, insertion-ordered", () => {
    const store = createStore<Entry>();
    store.register({ id: "a", value: 1 });
    store.register({ id: "b", value: 2 });
    expect(store.getSnapshot().map((e) => e.id)).toEqual(["a", "b"]);
  });

  it("register replaces an existing id in place", () => {
    const store = createStore<Entry>();
    store.register({ id: "a", value: 1 });
    store.register({ id: "a", value: 9 });
    expect(store.getSnapshot()).toHaveLength(1);
    expect(store.getSnapshot()[0].value).toBe(9);
  });

  it("update changes an entry in place, keyed on id", () => {
    const store = createStore<Entry>();
    store.register({ id: "a", value: 1 });
    store.update("a", { value: 5 });
    expect(store.getSnapshot()[0].value).toBe(5);
  });

  it("update on an unknown id is a no-op", () => {
    const store = createStore<Entry>();
    store.update("nope", { value: 5 });
    expect(store.getSnapshot()).toEqual([]);
  });

  it("deregister drops the entry", () => {
    const store = createStore<Entry>();
    const drop = store.register({ id: "a", value: 1 });
    store.register({ id: "b", value: 2 });
    drop();
    expect(store.getSnapshot().map((e) => e.id)).toEqual(["b"]);
  });

  it("getSnapshot is referentially stable while the set is unchanged", () => {
    const store = createStore<Entry>();
    store.register({ id: "a", value: 1 });
    const first = store.getSnapshot();
    expect(store.getSnapshot()).toBe(first);
  });

  it("returns a fresh snapshot only when the set actually changes", () => {
    const store = createStore<Entry>();
    const first = store.getSnapshot();
    store.register({ id: "a", value: 1 });
    expect(store.getSnapshot()).not.toBe(first);
  });

  it("notifies subscribers on register / update / deregister", () => {
    const store = createStore<Entry>();
    const onChange = vi.fn();
    const unsub = store.subscribe(onChange);
    const drop = store.register({ id: "a", value: 1 });
    store.update("a", { value: 2 });
    drop();
    expect(onChange).toHaveBeenCalledTimes(3);
    unsub();
    store.register({ id: "b", value: 3 });
    expect(onChange).toHaveBeenCalledTimes(3);
  });

  it("does not notify (and keeps snapshot identity) on a shallow-equal update", () => {
    const store = createStore<Entry>();
    store.register({ id: "a", value: 1 });
    const before = store.getSnapshot();
    const onChange = vi.fn();
    store.subscribe(onChange);
    store.update("a", { value: 1 });
    expect(onChange).not.toHaveBeenCalled();
    expect(store.getSnapshot()).toBe(before);
  });
});
