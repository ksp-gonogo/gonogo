import { renderHook } from "@ksp-gonogo/test-utils";
import { beforeEach, describe, expect, it } from "vitest";
import { WidgetMetaContext } from "../contexts/WidgetMetaContext";
import { clearContributions, registerContribution } from "../contributions";
import { ContributionsProvider } from "../contributionsRuntime";
import { useWidgetBadges } from "./useWidgetBadges";

beforeEach(() => clearContributions());

describe("useWidgetBadges", () => {
  it("reads contributions registered against `${componentId}.badges`, regardless of the widget's own declared contributionSlots", () => {
    registerContribution({
      id: "critical-badge",
      contributes: "fixture-widget.badges",
      compute: () => [{ id: "crit", label: "CRITICAL", tone: "nogo" as const }],
    });

    const { result } = renderHook(() => useWidgetBadges(), {
      wrapper: ({ children }) => (
        <WidgetMetaContext.Provider
          value={{ componentId: "fixture-widget", contributionSlots: [] }}
        >
          <ContributionsProvider>{children}</ContributionsProvider>
        </WidgetMetaContext.Provider>
      ),
    });

    expect(result.current.map((b) => b.label)).toEqual(["CRITICAL"]);
  });

  it("returns an empty array outside a WidgetMetaContext.Provider", () => {
    const { result } = renderHook(() => useWidgetBadges());
    expect(result.current).toEqual([]);
  });
});
