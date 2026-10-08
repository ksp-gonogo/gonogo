import { describe, expect, it } from "vitest";
import { memoryStorage } from "./memory-storage";

describe("memoryStorage", () => {
  it("counts and lists the keys it holds, as a browser Storage does", () => {
    const storage = memoryStorage();
    storage.setItem("a", "1");
    storage.setItem("b", "2");
    storage.setItem("a", "3");

    expect(storage.length).toBe(2);
    expect(storage.key(0)).toBe("a");
    expect(storage.key(1)).toBe("b");
    expect(storage.key(2)).toBeNull();

    storage.removeItem("a");
    expect(storage.length).toBe(1);
    expect(storage.key(0)).toBe("b");

    storage.clear();
    expect(storage.length).toBe(0);
  });
});
