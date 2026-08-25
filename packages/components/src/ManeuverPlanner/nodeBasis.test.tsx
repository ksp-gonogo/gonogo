import type { ParsedManeuverNode } from "@ksp-gonogo/data";
import { ManeuverFrame } from "@ksp-gonogo/sitrep-sdk";
import { act, render, screen } from "@ksp-gonogo/test-utils";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { NodeRow } from "./NodeRow";

/**
 * The node editor's three boxes are POSITIONAL slots, and which component sits
 * in each is the burn's own basis to say.
 *
 * `ManeuverNode.Frame` exists on the wire for exactly this, and its contract doc
 * spells the hazard out: under `TangentNormalBinormal` the field named
 * `DvRadial` carries the TANGENT and the one named `DvPrograde` carries the
 * BINORMAL, so a reader that labels by field name "silently rotates every burn
 * an integrating planner produces while looking right".
 *
 * A tangent is stock's prograde and a binormal is out of plane, so labelling
 * them by the stock names does not merely rename two numbers: it swaps the
 * along-track burn with the out-of-plane one, on a control the operator TYPES
 * INTO.
 *
 * The three components are 1 / 2 / 3 rather than a single non-zero, because a
 * fixture with one live axis cannot tell a correct labelling from a rotated
 * one: every wrong arrangement still shows the same numbers, just against
 * different words.
 */
function frenetNode(): ParsedManeuverNode {
  return {
    id: "principia:0",
    UT: 1_000,
    // The wire's positional slots, in the basis's own order: tangent, normal,
    // binormal.
    deltaV: [1, 2, 3],
    deltaVMagnitude: Math.hypot(1, 2, 3),
    frame: ManeuverFrame.TangentNormalBinormal,
    ignitionUt: null,
    cutoffUt: null,
    orbitPatches: [],
  };
}

function stockNode(): ParsedManeuverNode {
  return { ...frenetNode(), frame: ManeuverFrame.RadialNormalPrograde };
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

/**
 * `LabeledInput` wraps its input in the `<label>`, and the unit suffix is inside
 * that label too, so the accessible name is the component name followed by
 * "m/s". Anchored at the start so "Normal" cannot match "Binormal".
 */
function labelled(name: string): HTMLInputElement {
  return screen.getByLabelText(new RegExp(`^${name}`)) as HTMLInputElement;
}

describe("the node editor names the components the burn's own basis declares", () => {
  it("labels a Frenet burn tangent / normal / binormal", async () => {
    await openEditor(frenetNode());

    expect(labelled("Tangent").value).toBe("1");
    expect(labelled("Normal").value).toBe("2");
    expect(labelled("Binormal").value).toBe("3");
    await act(async () => {});
  });

  it("still labels a stock burn radial / normal / prograde", async () => {
    await openEditor(stockNode());

    expect(labelled("Radial").value).toBe("1");
    expect(labelled("Normal").value).toBe("2");
    expect(labelled("Prograde").value).toBe("3");
    await act(async () => {});
  });

  /**
   * A node that states no basis gets neutral slot names, not stock's.
   *
   * `RadialNormalPrograde` is ordinal zero, so defaulting is the easy mistake
   * and it is the dangerous direction: it asserts a basis the node declined to
   * state, over numbers that may be in another one. "Component 1" tells an
   * operator there is something to go and find out; "Prograde" tells them there
   * is not.
   *
   * The stock producer DOES state it (`StockManeuverPlanBackend`), so this is a
   * recording that predates the field or a provider that forgot, rather than
   * the ordinary path.
   */
  it("names the slots neutrally when the node states no basis", async () => {
    await openEditor({ ...frenetNode(), frame: null });

    expect(labelled("Component 1").value).toBe("1");
    expect(labelled("Component 2").value).toBe("2");
    expect(labelled("Component 3").value).toBe("3");
    expect(screen.queryByLabelText(/^Prograde/)).toBeNull();
    await act(async () => {});
  });
});
