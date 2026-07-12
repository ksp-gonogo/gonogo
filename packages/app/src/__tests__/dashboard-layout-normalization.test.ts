import { clearRegistry, registerComponent } from "@ksp-gonogo/core";
import type { Layouts } from "react-grid-layout";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DashboardItem } from "../components/Dashboard";
import {
  applyMinSizes,
  filterLayouts,
} from "../components/Dashboard/layoutNormalization";

describe("filterLayouts", () => {
  it("keeps known breakpoint keys", () => {
    const input: Layouts = {
      lg: [{ i: "a", x: 0, y: 0, w: 3, h: 3 }],
      md: [{ i: "a", x: 0, y: 0, w: 3, h: 3 }],
      sm: [{ i: "a", x: 0, y: 0, w: 3, h: 3 }],
      xs: [{ i: "a", x: 0, y: 0, w: 3, h: 3 }],
      xxs: [{ i: "a", x: 0, y: 0, w: 3, h: 3 }],
    };
    expect(Object.keys(filterLayouts(input)).sort()).toEqual(
      ["lg", "md", "sm", "xs", "xxs"].sort(),
    );
  });

  it("drops stale breakpoint keys not in COLS (e.g. xxxs)", () => {
    const input = {
      lg: [{ i: "a", x: 0, y: 0, w: 3, h: 3 }],
      xxxs: [{ i: "a", x: 0, y: 0, w: 3, h: 3 }],
    } as unknown as Layouts;
    const out = filterLayouts(input);
    expect(out.lg).toBeDefined();
    expect((out as Record<string, unknown>).xxxs).toBeUndefined();
  });

  it("returns an empty object for an empty input", () => {
    expect(filterLayouts({} as Layouts)).toEqual({});
  });
});

describe("applyMinSizes", () => {
  beforeEach(() => {
    clearRegistry();
  });
  afterEach(() => {
    clearRegistry();
  });

  function registerWithMin(id: string, min?: { w: number; h: number }) {
    registerComponent({
      id,
      name: id,
      description: id,
      tags: [],
      component: () => null,
      dataRequirements: [],
      defaultSize: { w: 3, h: 3 },
      ...(min ? { minSize: min } : {}),
    });
  }

  it("clamps w/h up to the registered minSize floor", () => {
    registerWithMin("with-min", { w: 6, h: 5 });
    const items: DashboardItem[] = [{ i: "a", componentId: "with-min" }];
    const out = applyMinSizes(
      { lg: [{ i: "a", x: 0, y: 0, w: 2, h: 2 }] },
      items,
    );
    expect(out.lg[0].w).toBe(6);
    expect(out.lg[0].h).toBe(5);
    expect(out.lg[0].minW).toBe(6);
    expect(out.lg[0].minH).toBe(5);
  });

  it("preserves entry identity when no change is needed", () => {
    registerWithMin("with-min", { w: 4, h: 4 });
    const items: DashboardItem[] = [{ i: "a", componentId: "with-min" }];
    const entry = { i: "a", x: 0, y: 0, w: 4, h: 4, minW: 4, minH: 4 };
    const out = applyMinSizes({ lg: [entry] }, items);
    // Same reference — RGL relies on this for reconciliation.
    expect(out.lg[0]).toBe(entry);
  });

  it("leaves entries untouched when the component has no minSize", () => {
    registerWithMin("no-min");
    const items: DashboardItem[] = [{ i: "a", componentId: "no-min" }];
    const entry = { i: "a", x: 0, y: 0, w: 1, h: 1 };
    const out = applyMinSizes({ lg: [entry] }, items);
    expect(out.lg[0]).toBe(entry);
  });

  it("leaves entries untouched when no item matches the layout id", () => {
    registerWithMin("with-min", { w: 6, h: 6 });
    const items: DashboardItem[] = [{ i: "other", componentId: "with-min" }];
    const entry = { i: "ghost", x: 0, y: 0, w: 1, h: 1 };
    const out = applyMinSizes({ lg: [entry] }, items);
    expect(out.lg[0]).toBe(entry);
  });

  it("applies across all breakpoint maps independently", () => {
    registerWithMin("with-min", { w: 5, h: 5 });
    const items: DashboardItem[] = [{ i: "a", componentId: "with-min" }];
    const out = applyMinSizes(
      {
        lg: [{ i: "a", x: 0, y: 0, w: 1, h: 1 }],
        md: [{ i: "a", x: 0, y: 0, w: 8, h: 8 }],
      },
      items,
    );
    expect(out.lg[0].w).toBe(5);
    expect(out.lg[0].h).toBe(5);
    expect(out.md[0].w).toBe(8);
    expect(out.md[0].h).toBe(8);
    expect(out.md[0].minW).toBe(5);
    expect(out.md[0].minH).toBe(5);
  });
});
