import { afterEach, describe, expect, it } from "vitest";
import {
  bootsWithoutDirectMod,
  currentRoute,
  isStationRoute,
} from "./isStationRoute";

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

  it("is base-path-relative, matches /gonogo/station under a sub-path BASE_URL (GitHub Pages)", () => {
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

describe("currentRoute", () => {
  afterEach(() => {
    setPath("/");
  });

  it("reads the root as the main screen", () => {
    setPath("/");
    expect(currentRoute()).toBe("main");
  });

  it("reads /pilot as the pilot seat", () => {
    setPath("/pilot");
    expect(currentRoute()).toBe("pilot");
  });

  it("reads /pilot with a query string", () => {
    setPath("/pilot?host=ABC123");
    expect(currentRoute()).toBe("pilot");
  });

  it("does not read a pilot page as a station", () => {
    // The two differ on the observation plane: a station is peer-fed and must
    // skip the direct-to-KSP boot, a pilot holds its own session and must not.
    setPath("/pilot");
    expect(isStationRoute()).toBe(false);
  });

  it("is base-path-relative under a sub-path BASE_URL", () => {
    const original = import.meta.env.BASE_URL;
    import.meta.env.BASE_URL = "/gonogo/";
    try {
      setPath("/gonogo/pilot");
      expect(currentRoute()).toBe("pilot");
      setPath("/gonogo/");
      expect(currentRoute()).toBe("main");
    } finally {
      import.meta.env.BASE_URL = original;
    }
  });
});

/**
 * The boot sequence asks a different question from the router: not "which
 * screen is this" but "is there a socket to the mod to probe". A pilot's
 * answer depends on the protocol, which is the whole of why this is its own
 * predicate.
 */
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

  it("is true for a station, which never holds a socket of its own", () => {
    at("/station", "https:");
    expect(bootsWithoutDirectMod()).toBe(true);
    at("/station", "http:");
    expect(bootsWithoutDirectMod()).toBe(true);
  });

  it("is FALSE for a pilot on http, which still holds its own session", () => {
    // The LAN case, and the better one: a session of the pilot's own, with no
    // dependence on mission control staying up.
    at("/pilot", "http:");
    expect(bootsWithoutDirectMod()).toBe(false);
  });

  it("is TRUE for a pilot on https, which cannot open an insecure socket", () => {
    at("/pilot", "https:");
    expect(bootsWithoutDirectMod()).toBe(true);
  });

  it("is false for the main screen, which is the only thing that still needs the probe", () => {
    at("/", "http:");
    expect(bootsWithoutDirectMod()).toBe(false);
  });
});
