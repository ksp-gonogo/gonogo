import type { ParsedManeuverNode } from "@ksp-gonogo/data";
import { COMMAND_LOST, value } from "@ksp-gonogo/sitrep-sdk";
import { act, render, screen } from "@ksp-gonogo/test-utils";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { NodeRow } from "./NodeRow";

const NODE: ParsedManeuverNode = {
  id: "node-1",
  UT: 1000,
  deltaV: [0, 0, 300],
  frame: null,
  deltaVMagnitude: 300,
  ignitionUt: 996,
  cutoffUt: 1004,
  orbitPatches: [],
};
const LANDED: ParsedManeuverNode = { ...NODE, deltaV: [0, 0, 350] };

function mount(
  node: ParsedManeuverNode,
  onEdit: () => Promise<void>,
  now = 500,
) {
  const ui = (n: ParsedManeuverNode, ut = now) => (
    <ul>
      <NodeRow
        node={n}
        currentUT={value("ut", ut)}
        availableDv={2000}
        onEdit={onEdit}
      />
    </ul>
  );
  const view = render(ui(node));
  return { rerender: (n: ParsedManeuverNode) => view.rerender(ui(n)) };
}

async function editAndSave() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Edit node" }));
  const field = screen.getByLabelText("Component 3");
  await user.clear(field);
  await user.type(field, "350");
  await user.click(screen.getByRole("button", { name: "Save" }));
}

describe("the node editor after Save", () => {
  it("stays open on Saving... after the reply until the node lists the new figures", async () => {
    const view = mount(NODE, () => Promise.resolve());
    await editAndSave();
    expect(screen.getByRole("button", { name: "Saving..." })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(screen.getByRole("button", { name: "Cancel" })).not.toHaveAttribute(
      "aria-disabled",
      "true",
    );
    act(() => view.rerender(LANDED));
    expect(screen.queryByRole("button", { name: "Saving..." })).toBeNull();
  });

  it("closes when a lost reply's edit lands later", async () => {
    const lost = Object.assign(new Error("lost"), { code: COMMAND_LOST });
    const view = mount(NODE, () => Promise.reject(lost));
    await editAndSave().catch(() => undefined);
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
    act(() => view.rerender(LANDED));
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });
});

describe("the node editor on a node in the past", () => {
  it("offers no edit once the node has passed", () => {
    mount(NODE, () => Promise.resolve(), 2000);
    expect(screen.queryByRole("button", { name: "Edit node" })).toBeNull();
  });

  it("says the burn was, not is, when an edited time lies behind the view clock", async () => {
    mount(NODE, () => Promise.resolve(), 500);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Edit node" }));
    expect(screen.getAllByText(/burn in/).length).toBeGreaterThan(0);
    for (let i = 0; i < 10; i++) {
      await user.click(
        screen.getByRole("button", { name: "UT earlier by 1min" }),
      );
    }
    const hints = Array.from(document.querySelectorAll("span, div, p")).map(
      (el) => el.textContent ?? "",
    );
    expect(hints.some((t) => /^burn was .* ago$/.test(t.trim()))).toBe(true);
  });
});
