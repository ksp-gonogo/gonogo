import {
  type Reading,
  staticValue,
  type Value,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import { render } from "@ksp-gonogo/sitrep-sdk/testing";
import { Unit } from "@ksp-gonogo/ui-kit";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import { figuresIn, unmarkedStaleFigures } from "./staleFigures";

const AT = value("ut", 1_000);

function held(figure: Value<"m">): Reading<Value<"m">> {
  return {
    state: "held",
    reckoning: { status: "none" },
    value: figure,
    asOfUt: AT,
    grade: "held",
  };
}

function figures(node: ReactElement) {
  const { container, unmount } = render(node);
  const found = figuresIn(container);
  unmount();
  return found;
}

describe("the unmarked-figure sweep can be seen to work", () => {
  it("counts a held number drawn as current", () => {
    const live = figures(<Unit value={value("m", 120)} />);
    const stale = figures(<Unit value={value("m", 120)} />);

    expect(unmarkedStaleFigures(live, stale)).toHaveLength(1);
  });

  it("skips a number marked held", () => {
    const live = figures(<Unit value={value("m", 120)} />);
    const stale = figures(<Unit value={held(value("m", 120))} />);

    expect(unmarkedStaleFigures(live, stale)).toEqual([]);
  });

  it("skips a static figure, which the kit never marks held", () => {
    const live = figures(<Unit value={staticValue("m", 600_000)} />);
    const stale = figures(<Unit value={held(staticValue("m", 600_000))} />);

    expect(stale).toEqual([
      expect.objectContaining({ isStatic: true, held: false }),
    ]);
    expect(unmarkedStaleFigures(live, stale)).toEqual([]);
  });

  it("skips a figure that changed", () => {
    const live = figures(<Unit value={value("m", 120)} />);
    const stale = figures(<Unit value={value("m", 95)} />);

    expect(unmarkedStaleFigures(live, stale)).toEqual([]);
  });
});
