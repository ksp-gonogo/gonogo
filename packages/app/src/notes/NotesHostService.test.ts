import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NotesHostService } from "./NotesHostService";

describe("NotesHostService", () => {
  beforeEach(() => {
    if (typeof localStorage !== "undefined") localStorage.clear();
  });

  afterEach(() => {
    if (typeof localStorage !== "undefined") localStorage.clear();
  });

  it("creates notes with monotonically increasing order", () => {
    const svc = new NotesHostService();
    const a = svc.addNote({ body: "first" });
    const b = svc.addNote({ body: "second" });
    expect(b.order).toBeGreaterThan(a.order);
  });

  it("emits a snapshot on each mutation", () => {
    const svc = new NotesHostService();
    const seen: number[] = [];
    svc.subscribe((s) => seen.push(s.notes.length));
    const a = svc.addNote({ body: "one" });
    svc.updateNote(a.id, "one!");
    svc.deleteNote(a.id);
    expect(seen).toEqual([1, 1, 0]);
  });

  it("no-ops when updating with the same body", () => {
    const svc = new NotesHostService();
    const seen: number[] = [];
    const a = svc.addNote({ body: "x" });
    svc.subscribe(() => seen.push(seen.length));
    svc.updateNote(a.id, "x");
    expect(seen).toHaveLength(0);
  });

  it("reorders by inserting after the named note and densely renumbers", () => {
    const svc = new NotesHostService();
    const a = svc.addNote({ body: "A" });
    const b = svc.addNote({ body: "B" });
    const c = svc.addNote({ body: "C" });

    // Move C between A and B → order: A, C, B.
    svc.reorderNote(c.id, a.id);
    const ordered = [...svc.snapshot().notes].sort((x, y) => x.order - y.order);
    expect(ordered.map((n) => n.id)).toEqual([a.id, c.id, b.id]);
    // Orders are dense (0, 1, 2) so a subsequent reorder doesn't collide.
    expect(ordered.map((n) => n.order)).toEqual([0, 1, 2]);
  });

  it("reorders to the head when afterId is null", () => {
    const svc = new NotesHostService();
    const a = svc.addNote({ body: "A" });
    const b = svc.addNote({ body: "B" });
    svc.reorderNote(b.id, null);
    const ordered = [...svc.snapshot().notes].sort((x, y) => x.order - y.order);
    expect(ordered.map((n) => n.id)).toEqual([b.id, a.id]);
  });

  it("persists to localStorage across instances", () => {
    const svc1 = new NotesHostService();
    svc1.addNote({ body: "stays" });
    const svc2 = new NotesHostService();
    expect(svc2.snapshot().notes.map((n) => n.body)).toEqual(["stays"]);
  });
});
