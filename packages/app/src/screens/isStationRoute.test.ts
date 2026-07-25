import { afterEach, describe, expect, it } from "vitest";
import { isStationRoute } from "./isStationRoute";

function setPath(path: string): void {
  globalThis.history.replaceState({}, "", path);
}

describe("isStationRoute", () => {
  afterEach(() => {
    setPath("/");
  });

  it("is false at the root path", () => {
    setPath("/");
    expect(isStationRoute()).toBe(false);
  });

  it("is false on an unrelated path", () => {
    setPath("/settings");
    expect(isStationRoute()).toBe(false);
  });

  it("is true at /station", () => {
    setPath("/station");
    expect(isStationRoute()).toBe(true);
  });

  it("is true at /station with a query string", () => {
    setPath("/station?host=ABC123");
    expect(isStationRoute()).toBe(true);
  });

  it("is base-path-relative — matches /gonogo/station under a sub-path BASE_URL (GitHub Pages)", () => {
    const original = import.meta.env.BASE_URL;
    import.meta.env.BASE_URL = "/gonogo/";
    try {
      setPath("/gonogo/station");
      expect(isStationRoute()).toBe(true);
      // The main screen's own path under the same sub-path base must NOT match.
      setPath("/gonogo/");
      expect(isStationRoute()).toBe(false);
    } finally {
      import.meta.env.BASE_URL = original;
    }
  });
});
