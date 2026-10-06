import {
  clearContributions,
  registerContribution,
} from "@ksp-gonogo/sitrep-sdk/spine";
import { act, render } from "@ksp-gonogo/sitrep-sdk/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearAugments, registerAugment } from "./augments";
import {
  createDomainAvailabilityStore,
  DomainAvailabilityContext,
} from "./domainAvailability";
import { sizeDeltaFor, useSizeDeltaFor, withSizeDelta } from "./sizeDelta";

const HOST = {
  id: "host-widget",
  augmentSlots: ["host-widget.sections"] as never,
  contributionSlots: [],
};

function augment(
  id: string,
  slot: string,
  extra: { requires?: string; sizeDelta?: { w?: number; h?: number } } = {},
) {
  registerAugment({
    id,
    augments: slot,
    component: () => null,
    ...extra,
  });
}

function present(...domains: string[]) {
  return (domain: string) => domains.includes(domain);
}

beforeEach(() => {
  clearAugments();
  clearContributions();
});
afterEach(() => {
  clearAugments();
  clearContributions();
});

describe("sizeDeltaFor", () => {
  it("is zero with nothing registered", () => {
    expect(sizeDeltaFor(HOST, present())).toEqual({ w: 0, h: 0 });
  });

  it("sums the augments bound to the widget's declared slots", () => {
    augment("a", "host-widget.sections", { sizeDelta: { w: 1 } });
    augment("b", "host-widget.sections", { sizeDelta: { w: 2, h: 1 } });
    expect(sizeDeltaFor(HOST, present())).toEqual({ w: 3, h: 1 });
  });

  it("ignores an augment whose Domain is absent", () => {
    augment("a", "host-widget.sections", {
      requires: "mod",
      sizeDelta: { h: 2 },
    });
    expect(sizeDeltaFor(HOST, present())).toEqual({ w: 0, h: 0 });
    expect(sizeDeltaFor(HOST, present("mod"))).toEqual({ w: 0, h: 2 });
  });

  it("ignores a slot the widget does not declare", () => {
    augment("a", "other-widget.sections", { sizeDelta: { w: 4 } });
    expect(sizeDeltaFor(HOST, present())).toEqual({ w: 0, h: 0 });
  });

  it("counts a contribution in the widget's declared slot or a universal segment", () => {
    registerContribution({
      id: "c1",
      contributes: "host-widget.badges",
      compute: () => null,
      sizeDelta: { h: 1 },
    } as never);
    registerContribution({
      id: "c2",
      contributes: "host-widget.rows",
      compute: () => null,
      sizeDelta: { w: 1 },
    } as never);
    expect(sizeDeltaFor(HOST, present())).toEqual({ w: 0, h: 1 });
    expect(
      sizeDeltaFor(
        { ...HOST, contributionSlots: ["host-widget.rows"] as never },
        present(),
      ),
    ).toEqual({ w: 1, h: 1 });
  });

  it("counts only the highest priority band of a slot's contributions", () => {
    registerContribution({
      id: "low",
      contributes: "host-widget.badges",
      priority: 0,
      compute: () => null,
      sizeDelta: { w: 5 },
    } as never);
    registerContribution({
      id: "high",
      contributes: "host-widget.badges",
      priority: 1,
      compute: () => null,
      sizeDelta: { w: 1 },
    } as never);
    expect(sizeDeltaFor(HOST, present())).toEqual({ w: 1, h: 0 });
  });

  it("counts a contribution whose Domain is absent as holding its band but adding nothing", () => {
    registerContribution({
      id: "gone",
      contributes: "host-widget.badges",
      requires: "mod",
      priority: 2,
      compute: () => null,
      sizeDelta: { w: 3 },
    } as never);
    registerContribution({
      id: "lower",
      contributes: "host-widget.badges",
      priority: 1,
      compute: () => null,
      sizeDelta: { w: 1 },
    } as never);
    expect(sizeDeltaFor(HOST, present())).toEqual({ w: 0, h: 0 });
    expect(sizeDeltaFor(HOST, present("mod"))).toEqual({ w: 3, h: 0 });
  });
});

describe("withSizeDelta", () => {
  it("returns the definition itself for a zero delta", () => {
    const def = { id: "x", minSize: { w: 3, h: 4 } };
    expect(withSizeDelta(def, { w: 0, h: 0 })).toBe(def);
  });

  it("adds the delta to minSize and defaultSize and nothing else", () => {
    const def = {
      id: "x",
      minSize: { w: 3, h: 4 },
      defaultSize: { w: 6, h: 8 },
    };
    expect(withSizeDelta(def, { w: 1, h: 2 })).toEqual({
      id: "x",
      minSize: { w: 4, h: 6 },
      defaultSize: { w: 7, h: 10 },
    });
  });

  it("starts from 1x1 for a minSize and 3x3 for a defaultSize the widget leaves out", () => {
    const bare: { minSize?: never; defaultSize?: never } = {};
    expect(withSizeDelta(bare, { w: 1, h: 0 })).toMatchObject({
      minSize: { w: 2, h: 1 },
      defaultSize: { w: 4, h: 3 },
    });
  });
});

describe("useSizeDeltaFor", () => {
  it("re-reads when an augment registers and when a Domain arrives", () => {
    const store = createDomainAvailabilityStore();
    let read: ReturnType<typeof useSizeDeltaFor> | undefined;
    function Probe() {
      read = useSizeDeltaFor();
      return null;
    }
    const { unmount } = render(
      <DomainAvailabilityContext.Provider value={store}>
        <Probe />
      </DomainAvailabilityContext.Provider>,
    );
    const first = read;
    expect(first?.(HOST)).toEqual({ w: 0, h: 0 });
    act(() => {
      augment("a", "host-widget.sections", {
        requires: "mod",
        sizeDelta: { w: 1 },
      });
    });
    expect(read).not.toBe(first);
    expect(read?.(HOST)).toEqual({ w: 0, h: 0 });
    act(() => store.setAvailable("mod", true));
    expect(read?.(HOST)).toEqual({ w: 1, h: 0 });
    unmount();
  });
});

describe("registering a size delta", () => {
  it.each([
    [{ w: -1 }],
    [{ w: 1.5 }],
    [{ h: -2 }],
    [{ w: Number.NaN }],
  ])("refuses %j on an augment", (delta) => {
    expect(() =>
      augment("a", "host-widget.sections", { sizeDelta: delta }),
    ).toThrow(/sizeDelta/);
  });
});
