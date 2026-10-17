import { describe, expect, it } from "vitest";
import { ModLogCursor } from "./modLogCursor";

describe("ModLogCursor", () => {
  it("returns every line of the first reply, and how many came before it", () => {
    const cursor = new ModLogCursor();
    expect(cursor.take(["a", "b"], 5, "boot-1")).toEqual({
      fresh: ["a", "b"],
      missed: 3,
    });
  });

  it("returns only the lines past the count already seen", () => {
    const cursor = new ModLogCursor();
    cursor.take(["a", "b"], 2, "boot-1");
    expect(cursor.take(["a", "b", "c", "d"], 4, "boot-1")).toEqual({
      fresh: ["c", "d"],
      missed: 0,
    });
    expect(cursor.take(["a", "b", "c", "d"], 4, "boot-1")).toEqual({
      fresh: [],
      missed: 0,
    });
  });

  it("returns a repeated line as many times as it was logged", () => {
    const cursor = new ModLogCursor();
    cursor.take(["same"], 1, "boot-1");
    expect(cursor.take(["same", "same", "same"], 3, "boot-1").fresh).toEqual([
      "same",
      "same",
    ]);
  });

  it("counts the lines the mod let go of between two reads", () => {
    const cursor = new ModLogCursor();
    cursor.take(["a"], 1, "boot-1");
    expect(cursor.take(["e", "f"], 6, "boot-1")).toEqual({
      fresh: ["e", "f"],
      missed: 3,
    });
  });

  it("starts again when the game restarts, even past the old count", () => {
    const cursor = new ModLogCursor();
    cursor.take(["a", "b", "c"], 3, "boot-1");
    expect(cursor.take(["x", "y", "z", "w"], 4, "boot-2")).toEqual({
      fresh: ["x", "y", "z", "w"],
      missed: 0,
    });
  });
});
