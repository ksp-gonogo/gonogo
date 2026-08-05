import { describe, expect, it, vi } from "vitest";
import { createPanelStatusStore } from "./PanelStatusStore";

describe("PanelStatusStore", () => {
  it("is empty (null summary) with no contributors", () => {
    const store = createPanelStatusStore();
    expect(store.getSummary()).toBeNull();
  });

  it("summarises a single contribution as itself", () => {
    const store = createPanelStatusStore();
    store.register({ id: "a", severity: "warning", label: "STALE" });
    expect(store.getSummary()).toEqual({ severity: "warning", label: "STALE" });
  });

  it("returns the WORST contribution's own label, not a merged one", () => {
    const store = createPanelStatusStore();
    store.register({ id: "stream", severity: "caution", label: "SYNCING" });
    store.register({
      id: "alarm",
      severity: "critical",
      label: "NO BURN VECTOR",
    });
    expect(store.getSummary()).toEqual({
      severity: "critical",
      label: "NO BURN VECTOR",
    });
  });

  it("second-topic-stale: a worse second contributor wins over a live-ish first", () => {
    // The exact bug the single-status path could not catch: one topic reads
    // fine, a second goes stale, and the panel must reflect the worst.
    const store = createPanelStatusStore();
    store.register({ id: "topic-1", severity: "nominal", label: "" });
    store.register({ id: "topic-2", severity: "warning", label: "STALE" });
    expect(store.getSummary()).toEqual({ severity: "warning", label: "STALE" });
  });

  it("update() moves the summary without re-registering", () => {
    const store = createPanelStatusStore();
    store.register({ id: "a", severity: "caution", label: "SYNCING" });
    store.update("a", { severity: "offline", label: "OFFLINE" });
    expect(store.getSummary()).toEqual({
      severity: "offline",
      label: "OFFLINE",
    });
  });

  it("deregister drops the summary to the next-worst contribution", () => {
    const store = createPanelStatusStore();
    const drop = store.register({
      id: "alarm",
      severity: "critical",
      label: "ALARM",
    });
    store.register({ id: "stream", severity: "caution", label: "SYNCING" });
    expect(store.getSummary()?.severity).toBe("critical");
    drop();
    expect(store.getSummary()).toEqual({
      severity: "caution",
      label: "SYNCING",
    });
  });

  it("returns null again once the last contributor deregisters", () => {
    const store = createPanelStatusStore();
    const drop = store.register({ id: "a", severity: "info", label: "NOTE" });
    drop();
    expect(store.getSummary()).toBeNull();
  });

  it("breaks a top-rank tie deterministically by registration order", () => {
    const store = createPanelStatusStore();
    store.register({ id: "first", severity: "warning", label: "FIRST" });
    store.register({ id: "second", severity: "warning", label: "SECOND" });
    // Earliest-registered contribution at the top rank wins, so the winning
    // label does not flicker between two equal-severity contributors.
    expect(store.getSummary()).toEqual({
      severity: "warning",
      label: "FIRST",
    });
  });

  it("getSummary() is referentially stable while the result is unchanged", () => {
    // The useSyncExternalStore no-loop guard: an identical snapshot must be the
    // same object, or React tears.
    const store = createPanelStatusStore();
    store.register({ id: "a", severity: "warning", label: "STALE" });
    const first = store.getSummary();
    const second = store.getSummary();
    expect(second).toBe(first);
    // A no-op update to the same values keeps identity too.
    store.update("a", { severity: "warning", label: "STALE" });
    expect(store.getSummary()).toBe(first);
  });

  it("returns a fresh object only when the merged result actually changes", () => {
    const store = createPanelStatusStore();
    store.register({ id: "a", severity: "warning", label: "STALE" });
    const first = store.getSummary();
    store.update("a", { severity: "critical", label: "GONE" });
    const next = store.getSummary();
    expect(next).not.toBe(first);
    expect(next).toEqual({ severity: "critical", label: "GONE" });
  });

  it("notifies subscribers on register / update / deregister", () => {
    const store = createPanelStatusStore();
    const onChange = vi.fn();
    const unsub = store.subscribe(onChange);
    const drop = store.register({ id: "a", severity: "info", label: "NOTE" });
    store.update("a", { severity: "warning", label: "STALE" });
    drop();
    expect(onChange).toHaveBeenCalledTimes(3);
    unsub();
    store.register({ id: "b", severity: "critical", label: "X" });
    expect(onChange).toHaveBeenCalledTimes(3);
  });

  it("a floor (nominal) contribution registers but never wins over anything above the floor", () => {
    const store = createPanelStatusStore();
    store.register({ id: "subsystem", severity: "nominal", label: "OK" });
    expect(store.getSummary()).toEqual({ severity: "nominal", label: "OK" });
    store.register({ id: "note", severity: "info", label: "NOTE" });
    expect(store.getSummary()).toEqual({ severity: "info", label: "NOTE" });
  });
});
