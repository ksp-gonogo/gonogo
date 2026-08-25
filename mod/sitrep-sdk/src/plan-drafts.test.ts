import { describe, expect, it, vi } from "vitest";
import { type ComposedBurn, ManeuverFrame } from "./__generated__/contract";
import { draftAsPlan, type PlanDraft, PlanDraftStore } from "./plan-drafts";
import { value } from "./unit-system/value";

function burn(ignitionUt: number): ComposedBurn {
  return {
    ignitionUt: value("ut", ignitionUt),
    frame: ManeuverFrame.TangentNormalBinormal,
    dvRadial: value("m/s", 0),
    dvNormal: value("m/s", 0),
    dvPrograde: value("m/s", 0),
    inertiallyFixed: false,
  };
}

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

  it("carries a request id built from the draft when sent", () => {
    // A retransmission after a silence has to be recognised as the same plan
    // rather than applied twice, and the request id is what does that.
    const store = new PlanDraftStore();
    const created = store.create(draft());

    expect(draftAsPlan(created).requestId).toContain(created.id);
  });

  it("keeps the request id across a retransmission of an unedited draft", () => {
    // The intent has not changed, so the id must not: this is the whole of what
    // makes a repeat safe.
    const store = new PlanDraftStore();
    const created = store.create(draft());

    const again = store.get(created.id);

    expect(draftAsPlan(again!).requestId).toBe(draftAsPlan(created).requestId);
  });

  it("gives an EDITED draft a request id the old receipt cannot answer", () => {
    // The failure this stops: the receiving side answers a repeated request id
    // from its replay cache without looking at the plan, so an edited draft sent
    // under the id its earlier version was sent under comes back with the
    // EARLIER answer. The operator reads "aboard" about a plan the craft has
    // never seen, and every later correction reads the same way.
    const store = new PlanDraftStore();
    const created = store.create(draft({ burns: [] }));
    const before = draftAsPlan(created).requestId;

    const edited = store.update(created.id, {
      burns: [burn(5000)],
      observedAt: value("ut", 950),
    });

    expect(draftAsPlan(edited!).requestId).not.toBe(before);
  });

  it("does not move the request id when only the saved flag changes", () => {
    // Saving and reopening decide nothing about the plan. Moving the id there
    // would spend the repeat protection on an operator changing their mind about
    // whether they had finished typing.
    const store = new PlanDraftStore();
    const created = store.create(draft({ burns: [burn(5000)] }));
    const before = draftAsPlan(created).requestId;

    const saved = store.update(created.id, { saved: true });

    expect(draftAsPlan(saved!).requestId).toBe(before);
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
