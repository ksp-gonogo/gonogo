import { renderHook } from "@ksp-gonogo/sitrep-sdk/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useListDashboard } from "./useListDashboard";

/** A `matchMedia` that answers the dashboard's query for one device and window width. */
function installDevice({ coarse, width }: { coarse: boolean; width: number }) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => {
      const below = /\(width < (\d+)px\)/.exec(query);
      const matches =
        (coarse && query.includes("(pointer: coarse)")) ||
        (below !== null && width < Number(below[1]));
      return {
        matches,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        onchange: null,
        dispatchEvent: () => false,
      };
    }),
  );
}

describe("useListDashboard", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows the list in a desktop window narrower than 700px", () => {
    installDevice({ coarse: false, width: 600 });
    expect(renderHook(() => useListDashboard()).result.current).toBe(true);
  });

  it("shows the grid in a desktop window 700px wide or more", () => {
    installDevice({ coarse: false, width: 700 });
    expect(renderHook(() => useListDashboard()).result.current).toBe(false);
  });

  it("shows the list on a touch device of any width", () => {
    installDevice({ coarse: true, width: 1280 });
    expect(renderHook(() => useListDashboard()).result.current).toBe(true);
  });
});
