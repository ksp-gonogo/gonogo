import {
  type ComponentProps,
  clearContributions,
  clearRegistry,
  registerComponent,
} from "@ksp-gonogo/core";
import { render } from "@ksp-gonogo/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

const gridWidths: number[] = [];

vi.mock("react-grid-layout", async (importOriginal) => {
  const real = await importOriginal<typeof import("react-grid-layout")>();
  const Real = real.default;
  return {
    ...real,
    default: (props: React.ComponentProps<typeof Real>) => {
      gridWidths.push(props.width as number);
      return <Real {...props} />;
    },
  };
});

vi.mock("@ksp-gonogo/components", () => ({
  SeatGuard: (props: { children: React.ReactNode }) => <>{props.children}</>,
  RequiresGuard: (props: { children: React.ReactNode }) => (
    <>{props.children}</>
  ),
}));

vi.mock("../../pushToMain/PushClientContext", () => ({
  usePushClient: () => null,
}));

import { GridDashboard } from "./GridDashboard";

function StubWidget(_: ComponentProps) {
  return <div />;
}

describe("GridDashboard first paint", () => {
  beforeEach(() => {
    gridWidths.length = 0;
    clearRegistry();
    clearContributions();
    registerComponent({
      id: "stub",
      name: "Stub",
      description: "Test stub",
      tags: [],
      component: StubWidget,
    });
  });

  it("is first drawn at the width of its container, so tiles do not slide into place after load", () => {
    vi.spyOn(globalThis, "getComputedStyle").mockReturnValue({
      width: "900px",
    } as CSSStyleDeclaration);

    render(
      <GridDashboard
        items={[{ i: "w1", componentId: "stub" }]}
        layout={[{ i: "w1", x: 0, y: 0, w: 6, h: 6 }]}
        onLayoutChange={vi.fn()}
        updateItemConfig={vi.fn()}
        updateItemMappings={vi.fn()}
        updateItemMobileWidth={vi.fn()}
        updateItemMobileHeight={vi.fn()}
        removeItem={vi.fn()}
        moveItemUp={vi.fn()}
        moveItemDown={vi.fn()}
      />,
    );

    expect(gridWidths.length).toBeGreaterThan(0);
    expect(new Set(gridWidths)).toEqual(new Set([900]));
  });
});
