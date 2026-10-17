import { clearRegistry, registerComponent } from "@ksp-gonogo/core";
import {
  clearAugments,
  registerAugment,
  sizeDeltaFor,
} from "@ksp-gonogo/ui-kit";
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
    } as Layouts;
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

  function registerWithMin(
    id: string,
    min?: { w: number; h: number },
    tiny = false,
  ) {
    registerComponent({
      id,
      name: id,
      description: id,
      tags: [],
      component: () => null,
      dataRequirements: [],
      defaultSize: { w: 3, h: 3 },
      ...(min ? { minSize: min } : {}),
      ...(tiny ? { tiny: { title: id, useEssentials: () => [] } } : {}),
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
    // Same reference: RGL relies on this for reconciliation.
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

  it("does not clamp a tiny widget's tile to its minSize, which is where its body stops fitting", () => {
    registerWithMin("tiny-widget", { w: 4, h: 5 }, true);
    const items: DashboardItem[] = [{ i: "a", componentId: "tiny-widget" }];
    const entry = { i: "a", x: 0, y: 0, w: 3, h: 3, minW: 3, minH: 3 };
    const out = applyMinSizes({ lg: [entry] }, items);
    expect(out.lg[0]).toBe(entry);
  });

  it("floors a tiny widget's minW and minH at the tiny size", () => {
    registerWithMin("tiny-widget", { w: 4, h: 5 }, true);
    const items: DashboardItem[] = [{ i: "a", componentId: "tiny-widget" }];
    const out = applyMinSizes(
      { lg: [{ i: "a", x: 0, y: 0, w: 5, h: 6 }] },
      items,
    );
    expect(out.lg[0]).toMatchObject({ w: 5, h: 6, minW: 3, minH: 3 });
  });

  it("clamps a tiny widget's tile smaller than the tiny size up to it", () => {
    registerWithMin("tiny-widget", { w: 4, h: 5 }, true);
    const items: DashboardItem[] = [{ i: "a", componentId: "tiny-widget" }];
    const out = applyMinSizes(
      { lg: [{ i: "a", x: 0, y: 0, w: 2, h: 2 }] },
      items,
    );
    expect(out.lg[0]).toMatchObject({ w: 3, h: 3, minW: 3, minH: 3 });
  });

  describe("with a maxSize", () => {
    function registerWithMax(
      min: { w: number; h: number } | undefined,
      max: { w: number; h: number },
    ) {
      registerComponent({
        id: "capped",
        name: "capped",
        description: "capped",
        tags: [],
        component: () => null,
        minSize: min,
        maxSize: max,
      });
    }
    const items: DashboardItem[] = [{ i: "a", componentId: "capped" }];

    it("injects maxW and maxH for the grid to stop a resize at", () => {
      registerWithMax({ w: 3, h: 3 }, { w: 10, h: 12 });
      const out = applyMinSizes(
        { lg: [{ i: "a", x: 0, y: 0, w: 5, h: 5 }] },
        items,
      );
      expect(out.lg[0]).toMatchObject({ w: 5, h: 5, maxW: 10, maxH: 12 });
    });

    it("clamps a saved tile larger than the cap down to it, per axis", () => {
      registerWithMax({ w: 3, h: 3 }, { w: 10, h: 12 });
      const out = applyMinSizes(
        { lg: [{ i: "a", x: 0, y: 0, w: 5, h: 20 }] },
        items,
      );
      expect(out.lg[0]).toMatchObject({ w: 5, h: 12 });
    });

    it("clamps with no minSize declared", () => {
      registerWithMax(undefined, { w: 6, h: 6 });
      const out = applyMinSizes(
        { lg: [{ i: "a", x: 0, y: 0, w: 9, h: 2 }] },
        items,
      );
      expect(out.lg[0]).toMatchObject({ w: 6, h: 2, maxW: 6, maxH: 6 });
    });

    it("returns the same entry when it already sits within the cap", () => {
      registerWithMax({ w: 3, h: 3 }, { w: 10, h: 12 });
      const entry = {
        i: "a",
        x: 0,
        y: 0,
        w: 4,
        h: 4,
        minW: 3,
        minH: 3,
        maxW: 10,
        maxH: 12,
      };
      expect(applyMinSizes({ lg: [entry] }, items).lg[0]).toBe(entry);
    });

    it("grows the cap by the room extensions ask for", () => {
      registerWithMax({ w: 3, h: 3 }, { w: 10, h: 12 });
      const out = applyMinSizes(
        { lg: [{ i: "a", x: 0, y: 0, w: 20, h: 20 }] },
        items,
        () => ({ w: 2, h: 1 }),
      );
      expect(out.lg[0]).toMatchObject({ w: 12, h: 13, maxW: 12, maxH: 13 });
    });

    it("refuses a registration whose maxSize is below its minSize on either axis", () => {
      expect(() => registerWithMax({ w: 6, h: 6 }, { w: 5, h: 8 })).toThrow(
        /maxSize 5x8, below its minSize 6x6/,
      );
      expect(() => registerWithMax({ w: 6, h: 6 }, { w: 8, h: 5 })).toThrow(
        /maxSize 8x5, below its minSize 6x6/,
      );
    });
  });

  describe("with an extension asking for room", () => {
    afterEach(() => clearAugments());

    function registerHost(tiny: boolean, requires?: string) {
      registerComponent({
        id: "host",
        name: "host",
        description: "host",
        tags: [],
        component: () => null,
        dataRequirements: [],
        defaultSize: { w: 6, h: 6 },
        minSize: { w: 4, h: 5 },
        augmentSlots: ["host.sections"] as never,
        ...(tiny ? { tiny: { title: "host", useEssentials: () => [] } } : {}),
      });
      registerAugment({
        id: "host-extra",
        augments: "host.sections",
        component: () => null,
        requires,
        sizeDelta: { w: 1 },
      });
    }
    const items: DashboardItem[] = [{ i: "a", componentId: "host" }];

    it("clamps a non-tiny widget's saved tile one wider", () => {
      registerHost(false);
      const out = applyMinSizes(
        { lg: [{ i: "a", x: 0, y: 0, w: 4, h: 5 }] },
        items,
        (def) => sizeDeltaFor(def, () => true),
      );
      expect(out.lg[0]).toMatchObject({ w: 5, h: 5, minW: 5, minH: 5 });
    });

    it("leaves a tiny widget's tile alone, since the delta moves only where it switches to its tiny form", () => {
      registerHost(true);
      const entry = { i: "a", x: 0, y: 0, w: 4, h: 5, minW: 3, minH: 3 };
      const out = applyMinSizes({ lg: [entry] }, items, (def) =>
        sizeDeltaFor(def, () => true),
      );
      expect(out.lg[0]).toBe(entry);
    });

    it("does not clamp when the extension's Domain is absent", () => {
      registerHost(false, "mod");
      const entry = { i: "a", x: 0, y: 0, w: 4, h: 5, minW: 4, minH: 5 };
      const out = applyMinSizes({ lg: [entry] }, items, (def) =>
        sizeDeltaFor(def, () => false),
      );
      expect(out.lg[0]).toBe(entry);
    });
  });
});
