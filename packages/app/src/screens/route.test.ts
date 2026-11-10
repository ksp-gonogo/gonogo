import { afterEach, describe, expect, it } from "vitest";
import { bootsWithoutDirectMod, currentRoute } from "./route";

function setPath(path: string): void {
  globalThis.history.replaceState({}, "", path);
}

describe("currentRoute", () => {
  afterEach(() => {
    setPath("/");
  });

  it.each([
    ["/", "main"],
    ["/join", "join"],
    ["/join?ABC234", "join"],
    ["/station", "main"],
    ["/pilot", "main"],
    ["/joinery", "main"],
  ])("reads %s as %s", (path, route) => {
    setPath(path);
    expect(currentRoute()).toBe(route);
  });

  it("is base-path-relative under a sub-path BASE_URL", () => {
    const original = import.meta.env.BASE_URL;
    import.meta.env.BASE_URL = "/app/";
    try {
      setPath("/app/join?ABC234");
      expect(currentRoute()).toBe("join");
      setPath("/app/");
      expect(currentRoute()).toBe("main");
    } finally {
      import.meta.env.BASE_URL = original;
    }
  });
});

describe("bootsWithoutDirectMod", () => {
  const realLocation = globalThis.location;
  afterEach(() => {
    Object.defineProperty(globalThis, "location", {
      value: realLocation,
      writable: true,
      configurable: true,
    });
  });

  function at(pathname: string, protocol: string): void {
    Object.defineProperty(globalThis, "location", {
      value: { ...realLocation, pathname, protocol },
      writable: true,
      configurable: true,
    });
  }

  it("is true for a joined screen on any origin, which reads through the host", () => {
    at("/join", "https:");
    expect(bootsWithoutDirectMod()).toBe(true);
    at("/join", "http:");
    expect(bootsWithoutDirectMod()).toBe(true);
  });

  it("is true for the hosted landing page, which has no mod to probe", () => {
    at("/", "https:");
    expect(bootsWithoutDirectMod()).toBe(true);
  });

  it("is false for the local screen on http, which holds its own session", () => {
    at("/", "http:");
    expect(bootsWithoutDirectMod()).toBe(false);
  });
});
