import { describe, expect, it, vi } from "vitest";
import { draftAsPlan, type PlanDraft, PlanDraftStore } from "./plan-drafts";
import { value } from "./unit-system/value";

function draft(overrides: Partial<Omit<PlanDraft, "id">> = {}) {
  return {
    name: "Transfer",
    vesselId: "v1",
    burns: [],
    observedAt: value("ut", 900),
    ...overrides,
  };
}

describe("the command centre's own plans", () => {
  it("holds more than one plan for the same craft", () => {
    // The whole reason drafts live here: two operators can work on different
    // plans for one craft because neither is touching the game.
    const store = new PlanDraftStore();

    const a = store.create(draft({ name: "Direct" }));
    const b = store.create(draft({ name: "Bi-elliptic" }));

    expect(a.id).not.toBe(b.id);
    expect(store.forVessel("v1")).toHaveLength(2);
  });

  it("gives two identical drafts separate ids", () => {
    // An operator made them separately and may be comparing them, so identical
    // contents are still two drafts.
    const store = new PlanDraftStore();

    const a = store.create(draft());
    const b = store.create(draft());

    expect(a.id).not.toBe(b.id);
  });

  it("returns the SAME array when nothing changed", () => {
    // useSyncExternalStore compares by identity, so a fresh array every call is
    // an infinite render. This shape invites that bug, which is why it is
    // pinned rather than left to the implementation.
    const store = new PlanDraftStore();
    store.create(draft());

    expect(store.list()).toBe(store.list());
  });

  it("returns a different array once something changed", () => {
    // The other half: a cache that never invalidates renders stale forever.
    const store = new PlanDraftStore();
    store.create(draft());
    const before = store.list();

    store.create(draft({ name: "Second" }));

    expect(store.list()).not.toBe(before);
  });

  it("tells subscribers when a draft is added, changed or discarded", () => {
    const store = new PlanDraftStore();
    const listener = vi.fn();
    store.subscribe(listener);

    const created = store.create(draft());
    store.update(created.id, { name: "Renamed" });
    store.remove(created.id);

    expect(listener).toHaveBeenCalledTimes(3);
  });

  it("does not tell subscribers about a discard that discarded nothing", () => {
    // A notification with no change behind it re-renders every reader for
    // nothing, and on a store read by a dashboard that is a real cost.
    const store = new PlanDraftStore();
    const listener = vi.fn();
    store.subscribe(listener);

    expect(store.remove("draft-nope")).toBe(false);
    expect(listener).not.toHaveBeenCalled();
  });

  it("answers undefined rather than inventing a draft to update", () => {
    const store = new PlanDraftStore();

    expect(store.update("draft-nope", { name: "x" })).toBeUndefined();
  });

  it("keeps a draft's id across an update", () => {
    // The id is what a send addresses as its request id, so a draft that
    // changed id under an edit would be applied twice by the receiving side.
    const store = new PlanDraftStore();
    const created = store.create(draft());

    const updated = store.update(created.id, { name: "Renamed" });

    expect(updated?.id).toBe(created.id);
  });

  it("carries the draft's id as the request id when sent", () => {
    // A draft IS the intent, so its id is the intent's id: a retransmission
    // after a silence is recognised as the same plan rather than applied twice.
    const store = new PlanDraftStore();
    const created = store.create(draft());

    expect(draftAsPlan(created).requestId).toBe(created.id);
  });

  it("does not send the name", () => {
    // The craft has no use for one.
    const store = new PlanDraftStore();
    const created = store.create(draft({ name: "Bi-elliptic" }));

    expect(JSON.stringify(draftAsPlan(created))).not.toContain("Bi-elliptic");
  });

  it("sends the instant the draft was BUILT against, not a fresh one", () => {
    // It says how old the information the operator decided on was, which is a
    // property of the moment they decided. Re-reading it at send time would
    // stamp the plan with the age of data nobody used.
    const store = new PlanDraftStore();
    const created = store.create(draft({ observedAt: value("ut", 880) }));

    expect(draftAsPlan(created).observedAt.magnitude).toBe(880);
  });

  it("keeps one craft's drafts out of another's", () => {
    const store = new PlanDraftStore();
    store.create(draft({ vesselId: "v1" }));
    store.create(draft({ vesselId: "v2" }));

    expect(store.forVessel("v2")).toHaveLength(1);
  });
});
