import type { ParsedManeuverNode } from "@ksp-gonogo/data";
import { ManeuverFrame } from "@ksp-gonogo/sitrep-sdk";
import { act, render, screen } from "@ksp-gonogo/test-utils";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { NodeRow } from "./NodeRow";

/**
 * The editor's three boxes are positional slots labelled from the burn's own
 * basis. A basis nothing stated, or one this build does not recognise, gets
 * Components 1/2/3: stock names would assert a basis nobody declared.
 */
function stockNode(): ParsedManeuverNode {
  return {
    id: "planner:0",
    UT: 1_000,
    deltaV: [1, 2, 3],
    deltaVMagnitude: Math.hypot(1, 2, 3),
    frame: ManeuverFrame.RadialNormalPrograde,
    ignitionUt: null,
    cutoffUt: null,
    orbitPatches: [],
  };
}

async function openEditor(node: ParsedManeuverNode) {
  const view = render(
    <NodeRow
      node={node}
      currentUT={0}
      availableDv={500}
      onEdit={async () => {}}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: "Edit node" }));
  return view;
}

/** The accessible name ends in the unit suffix, so the match is anchored at the start. */
function labelled(name: string): HTMLInputElement {
  return screen.getByLabelText(new RegExp(`^${name}`)) as HTMLInputElement;
}

describe("the node editor names the components the burn's own basis declares", () => {
  it("labels a stock burn radial / normal / prograde", async () => {
    await openEditor(stockNode());

    expect(labelled("Radial").value).toBe("1");
    expect(labelled("Normal").value).toBe("2");
    expect(labelled("Prograde").value).toBe("3");
    await act(async () => {});
  });

  // Defaulting to stock names would assert a basis the node declined to state.
  it("names the slots neutrally when the node states no basis", async () => {
    await openEditor({ ...stockNode(), frame: null });

    expect(labelled("Component 1").value).toBe("1");
    expect(labelled("Component 2").value).toBe("2");
    expect(labelled("Component 3").value).toBe("3");
    expect(screen.queryByLabelText(/^Prograde/)).toBeNull();
    await act(async () => {});
  });

  it("names the slots neutrally for a basis this build does not recognise", async () => {
    await openEditor({ ...stockNode(), frame: ManeuverFrame.Unknown });

    expect(labelled("Component 1").value).toBe("1");
    expect(labelled("Component 3").value).toBe("3");
    expect(screen.queryByLabelText(/^Radial/)).toBeNull();
    await act(async () => {});
  });
});

describe("the node editor edits through the kit's UnitInput", () => {
  it("saves a typed component as a number, with the instant untouched", async () => {
    const saved: unknown[] = [];
    render(
      <NodeRow
        node={stockNode()}
        currentUT={0}
        availableDv={500}
        onEdit={async (patch) => {
          saved.push(patch);
        }}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Edit node" }));
    const prograde = labelled("Prograde");
    await userEvent.clear(prograde);
    await userEvent.type(prograde, "7");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(saved).toEqual([
      expect.objectContaining({ prograde: 7, ut: stockNode().UT }),
    ]);
    await act(async () => {});
  });
});
