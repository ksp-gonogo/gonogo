import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NotesHostService } from "./NotesHostService";
import type { Note } from "./types";

const HOME = "ground:home";
const CREW = "vessel:abc";

const legacyNote = (id: string, body: string, order: number) => ({
  id,
  body,
  order,
  createdAt: 0,
  updatedAt: 0,
});

describe("NotesHostService", () => {
  beforeEach(() => {
    if (typeof localStorage !== "undefined") localStorage.clear();
  });

  afterEach(() => {
    if (typeof localStorage !== "undefined") localStorage.clear();
  });

  it("creates notes with monotonically increasing order", () => {
    const svc = new NotesHostService();
    const a = svc.addNote(HOME, { body: "first" });
    const b = svc.addNote(HOME, { body: "second" });
    expect(b.order).toBeGreaterThan(a.order);
  });

  it("emits the changed centre's snapshot on each mutation", () => {
    const svc = new NotesHostService();
    const seen: Array<[string | null, number]> = [];
    svc.subscribe((s) => seen.push([s.centreId, s.notes.length]));
    const a = svc.addNote(HOME, { body: "one" });
    svc.updateNote(HOME, a.id, "one!", a.version);
    svc.deleteNote(HOME, a.id, a.version + 1);
    expect(seen).toEqual([
      [HOME, 1],
      [HOME, 1],
      [HOME, 0],
    ]);
  });

  it("keeps a separate list for each command centre", () => {
    const svc = new NotesHostService();
    svc.addNote(HOME, { body: "home note" });
    svc.addNote(CREW, { body: "crew note" });
    expect(svc.snapshot(HOME).notes.map((n) => n.body)).toEqual(["home note"]);
    expect(svc.snapshot(CREW).notes.map((n) => n.body)).toEqual(["crew note"]);
  });

  it("has no list for a screen that has no centre", () => {
    const svc = new NotesHostService();
    svc.addNote(HOME, { body: "home note" });
    expect(svc.snapshot(null)).toEqual({ centreId: null, notes: [] });
  });

  it("no-ops when updating with the same body", () => {
    const svc = new NotesHostService();
    const seen: number[] = [];
    const a = svc.addNote(HOME, { body: "x" });
    svc.subscribe(() => seen.push(seen.length));
    expect(svc.updateNote(HOME, a.id, "x", a.version)).toEqual({ ok: true });
    expect(seen).toHaveLength(0);
  });

  it("refuses an update made against a version that has moved on, and keeps the first edit", () => {
    const svc = new NotesHostService();
    const a = svc.addNote(HOME, { body: "start" });
    expect(svc.updateNote(HOME, a.id, "from the station", a.version)).toEqual({
      ok: true,
    });
    const refused = svc.updateNote(
      HOME,
      a.id,
      "from the main screen",
      a.version,
    );
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.current?.body).toBe("from the station");
    expect(svc.snapshot(HOME).notes[0].body).toBe("from the station");
  });

  it("refuses an edit to a note deleted meanwhile, naming it as gone", () => {
    const svc = new NotesHostService();
    const a = svc.addNote(HOME, { body: "start" });
    svc.deleteNote(HOME, a.id, a.version);
    expect(svc.updateNote(HOME, a.id, "late", a.version)).toEqual({
      ok: false,
      current: null,
    });
  });

  it("refuses a delete against a stale version and keeps the note", () => {
    const svc = new NotesHostService();
    const a = svc.addNote(HOME, { body: "start" });
    svc.updateNote(HOME, a.id, "changed", a.version);
    const refused = svc.deleteNote(HOME, a.id, a.version);
    expect(refused.ok).toBe(false);
    expect(svc.snapshot(HOME).notes).toHaveLength(1);
  });

  it("does not let a note be edited through another centre's list", () => {
    const svc = new NotesHostService();
    const a = svc.addNote(HOME, { body: "home note" });
    expect(svc.updateNote(CREW, a.id, "crew edit", a.version)).toEqual({
      ok: false,
      current: null,
    });
    expect(svc.snapshot(HOME).notes[0].body).toBe("home note");
  });

  it("reorders by inserting after the named note and densely renumbers", () => {
    const svc = new NotesHostService();
    const a = svc.addNote(HOME, { body: "A" });
    svc.addNote(HOME, { body: "B" });
    const c = svc.addNote(HOME, { body: "C" });

    // Move C between A and B → order: A, C, B.
    svc.reorderNote(HOME, c.id, a.id, c.version);
    const ordered = [...svc.snapshot(HOME).notes].sort(
      (x, y) => x.order - y.order,
    );
    expect(ordered.map((n) => n.body)).toEqual(["A", "C", "B"]);
    // Orders are dense (0, 1, 2) so a subsequent reorder doesn't collide.
    expect(ordered.map((n) => n.order)).toEqual([0, 1, 2]);
  });

  it("reorders to the head when afterId is null", () => {
    const svc = new NotesHostService();
    svc.addNote(HOME, { body: "A" });
    const b = svc.addNote(HOME, { body: "B" });
    svc.reorderNote(HOME, b.id, null, b.version);
    const ordered = [...svc.snapshot(HOME).notes].sort(
      (x, y) => x.order - y.order,
    );
    expect(ordered.map((n) => n.body)).toEqual(["B", "A"]);
  });

  it("persists every centre's list across instances", () => {
    const svc1 = new NotesHostService();
    svc1.addNote(HOME, { body: "stays" });
    svc1.addNote(CREW, { body: "also stays" });
    const svc2 = new NotesHostService();
    expect(svc2.snapshot(HOME).notes.map((n) => n.body)).toEqual(["stays"]);
    expect(svc2.snapshot(CREW).notes.map((n) => n.body)).toEqual([
      "also stays",
    ]);
  });

  describe("the list kept from before notes were per centre", () => {
    const seed = () =>
      localStorage.setItem(
        "gonogo.notes.v1",
        JSON.stringify([legacyNote("o1", "old note", 0)]),
      );

    it("belongs to no centre until one is resolved", () => {
      seed();
      const svc = new NotesHostService();
      expect(svc.snapshot(HOME).notes).toEqual([]);
      expect(svc.snapshot(CREW).notes).toEqual([]);
      expect(localStorage.getItem("gonogo.notes.v1")).not.toBeNull();
    });

    it("moves whole to the first centre resolved, with a first version, and is then gone from storage", () => {
      seed();
      const svc = new NotesHostService();
      svc.adoptLegacy(HOME);
      const [adopted]: readonly Note[] = svc.snapshot(HOME).notes;
      expect(adopted).toMatchObject({ id: "o1", body: "old note", version: 1 });
      expect(localStorage.getItem("gonogo.notes.v1")).toBeNull();
      svc.adoptLegacy(CREW);
      expect(svc.snapshot(CREW).notes).toEqual([]);
    });

    it("survives a reload that happens before any centre is resolved", () => {
      seed();
      new NotesHostService();
      const reloaded = new NotesHostService();
      reloaded.adoptLegacy(HOME);
      expect(reloaded.snapshot(HOME).notes.map((n) => n.body)).toEqual([
        "old note",
      ]);
    });
  });
});
