import { renderHook } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { PanelBadgesProvider, usePanelBadgesContext } from "./PanelBadges";

describe("usePanelBadgesContext", () => {
  it("returns null outside a PanelBadgesProvider", () => {
    const { result } = renderHook(() => usePanelBadgesContext());
    expect(result.current).toBeNull();
  });

  it("returns the provided badges array inside a PanelBadgesProvider", () => {
    const badges = [{ id: "b1", label: "CRITICAL", tone: "nogo" as const }];
    const { result } = renderHook(() => usePanelBadgesContext(), {
      wrapper: ({ children }) => (
        <PanelBadgesProvider badges={badges}>{children}</PanelBadgesProvider>
      ),
    });
    expect(result.current).toBe(badges);
  });
});
