import { value } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import { ModLogCursor } from "./modLogCursor";

const count = (n: number) => value("count", n);

describe("ModLogCursor", () => {
  it("returns every line of the first reply, and how many came before it", () => {
    const cursor = new ModLogCursor();
    expect(cursor.take(["a", "b"], count(5), "boot-1")).toEqual({
      fresh: ["a", "b"],
      missed: count(3),
    });
  });

  it("returns only the lines past the count already seen", () => {
    const cursor = new ModLogCursor();
    cursor.take(["a", "b"], count(2), "boot-1");
    expect(cursor.take(["a", "b", "c", "d"], count(4), "boot-1")).toEqual({
      fresh: ["c", "d"],
      missed: count(0),
    });
    expect(cursor.take(["a", "b", "c", "d"], count(4), "boot-1")).toEqual({
      fresh: [],
      missed: count(0),
    });
  });

  it("returns a repeated line as many times as it was logged", () => {
    const cursor = new ModLogCursor();
    cursor.take(["same"], count(1), "boot-1");
    expect(
      cursor.take(["same", "same", "same"], count(3), "boot-1").fresh,
    ).toEqual(["same", "same"]);
  });

  it("counts the lines the mod let go of between two reads", () => {
    const cursor = new ModLogCursor();
    cursor.take(["a"], count(1), "boot-1");
    expect(cursor.take(["e", "f"], count(6), "boot-1")).toEqual({
      fresh: ["e", "f"],
      missed: count(3),
    });
  });

  it("starts again when the game restarts, even past the old count", () => {
    const cursor = new ModLogCursor();
    cursor.take(["a", "b", "c"], count(3), "boot-1");
    expect(cursor.take(["x", "y", "z", "w"], count(4), "boot-2")).toEqual({
      fresh: ["x", "y", "z", "w"],
      missed: count(0),
    });
  });
});
