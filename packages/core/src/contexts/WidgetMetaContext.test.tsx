import { renderHook } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { useWidgetMeta, WidgetMetaContext } from "./WidgetMetaContext";

describe("useWidgetMeta", () => {
  it("returns null outside a WidgetMetaContext.Provider", () => {
    const { result } = renderHook(() => useWidgetMeta());
    expect(result.current).toBeNull();
  });

  it("returns the provided componentId and contributionSlots inside a Provider", () => {
    const { result } = renderHook(() => useWidgetMeta(), {
      wrapper: ({ children }) => (
        <WidgetMetaContext.Provider
          value={{
            componentId: "ship-map",
            contributionSlots: ["ship-map.part-meta"],
          }}
        >
          {children}
        </WidgetMetaContext.Provider>
      ),
    });
    expect(result.current).toEqual({
      componentId: "ship-map",
      contributionSlots: ["ship-map.part-meta"],
    });
  });
});
