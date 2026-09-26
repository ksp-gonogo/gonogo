import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { beforeEach, describe, expect, it } from "vitest";
import { AugmentSlot } from "./AugmentSlot";
import { clearAugments, registerAugment } from "./augments";
import { FRAMEWORK_AUGMENT_SEGMENTS, Panel } from "./Panel";
import { WidgetMetaContext } from "./WidgetMetaContext";

beforeEach(() => clearAugments());

/* Declared because an undeclared slot id carries no props at all. */
declare module "@ksp-gonogo/sitrep-sdk" {
  interface SlotRegistry {
    "deployed.sections": { row?: string };
  }
}

/**
 * A widget-authored slot whose id ends in a framework segment is the same
 * string the universal segment completes to, so both mounts fire and the
 * augment renders twice, the second time with the segment's empty props.
 */
describe("a widget-authored slot must not end in a framework segment", () => {
  it("renders a colliding slot's augment twice, the second time with no props", () => {
    const seen: Array<string | undefined> = [];
    registerAugment({
      id: "per-row",
      augments: "deployed.sections",
      component: ({ row }: { row?: string }) => {
        seen.push(row);
        return <span>row {row ?? "MISSING"}</span>;
      },
    });

    render(
      <WidgetMetaContext.Provider
        value={{ componentId: "deployed", contributionSlots: [] }}
      >
        <Panel panelTitle="DEPLOYED">
          <AugmentSlot name="deployed.sections" props={{ row: "a" }} />
        </Panel>
      </WidgetMetaContext.Provider>,
    );

    // The widget's own mount got its props; `Panel`'s universal mount did not.
    expect(seen).toEqual(["a", undefined]);
    expect(screen.getByText("row MISSING")).toBeInTheDocument();
  });

  it("names the segments a widget-authored slot id may not end in", () => {
    // A widget slot may be called anything except these, which `Panel` mounts for every widget.
    expect([...FRAMEWORK_AUGMENT_SEGMENTS]).toEqual(["sections", "actions"]);
  });
});
