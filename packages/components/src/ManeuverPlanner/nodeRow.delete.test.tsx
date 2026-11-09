import type { ParsedManeuverNode } from "@ksp-gonogo/data";
import { value } from "@ksp-gonogo/sitrep-sdk";
import { createFakeCommand } from "@ksp-gonogo/sitrep-sdk/testing";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@ksp-gonogo/test-utils";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
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

const REASON = "the vessel is not controllable";

function mount(answer: "confirm" | "hold" = "hold") {
  const remove = createFakeCommand({ answer });
  const tree = () => (
    <ul>
      <NodeRow
        node={NODE}
        currentUT={value("ut", 100)}
        availableDv={2000}
        removeCommand={remove.handle.with(
          { nodeId: NODE.id },
          { label: "Remove maneuver node" },
        )}
        onEdit={async () => {}}
      />
    </ul>
  );
  const view = render(tree());
  return { remove, ...view, redraw: () => view.rerender(tree()) };
}

const deleteButton = () => screen.getAllByRole("button").at(-1) as HTMLElement;

/** What the screen reader hears from the control's own live regions. */
const announced = (container: HTMLElement) =>
  [...container.querySelectorAll("[aria-live]")]
    .map((n) => n.textContent)
    .join(" ");

describe("NodeRow delete control, in every phase", () => {
  it("at rest is a named button with no accessibility violations", async () => {
    const { container } = mount("confirm");
    const del = screen.getByRole("button", { name: "Delete node" });
    expect(del.tagName).toBe("BUTTON");
    await expectNoA11yViolations(container);
  });

  it("names the press and what became of it, in the name and on keyboard focus", async () => {
    const { container, remove, redraw } = mount("hold");
    fireEvent.click(screen.getByRole("button", { name: "Delete node" }));
    redraw();
    // Sent: the name says the press went out and has not been answered.
    const sent = await screen.findByRole("button", {
      name: /Remove maneuver node sent, not yet received/,
    });
    fireEvent.focus(sent);
    await waitFor(() =>
      expect(document.querySelector("[data-tooltip-tip]")?.textContent).toMatch(
        /sent, not yet received/,
      ),
    );
    await expectNoA11yViolations(container);

    // Refused: the name carries the reason, it is announced, and focus shows it.
    act(() => {
      remove.refuse(REASON);
    });
    redraw();
    const refused = await screen.findByRole("button", {
      name: new RegExp(`refused: ${REASON}`),
    });
    expect(announced(container)).toMatch(new RegExp(`refused: ${REASON}`));
    fireEvent.blur(refused);
    fireEvent.focus(refused);
    await waitFor(() =>
      expect(document.querySelector("[data-tooltip-tip]")?.textContent).toMatch(
        new RegExp(REASON),
      ),
    );
    await expectNoA11yViolations(container);
  });

  it("says when no reply came, in the name and to a screen reader", async () => {
    const { container, remove, redraw } = mount("hold");
    fireEvent.click(screen.getByRole("button", { name: "Delete node" }));
    redraw();
    act(() => {
      remove.lose();
    });
    redraw();
    await screen.findByRole("button", { name: /no reply/ });
    expect(announced(container)).toMatch(/no reply/);
    await expectNoA11yViolations(container);
  });

  it("when the game will refuse it keeps its name, gives the reason to focus and to a screen reader, and is not pressable", async () => {
    const { container, remove, redraw } = mount("hold");
    remove.patch({
      gateStopsPress: true,
      gate: {
        blocked: true,
        undetermined: false,
        command: "vessel.maneuver.remove",
        errorCode: "wrongState",
        detail: REASON,
      },
    });
    redraw();
    const del = screen.getByRole("button", { name: "Delete node" });
    expect(del.getAttribute("aria-disabled")).toBe("true");
    expect(del.getAttribute("aria-description")).toMatch(new RegExp(REASON));
    fireEvent.focus(del);
    await waitFor(() =>
      expect(document.querySelector("[data-tooltip-tip]")?.textContent).toMatch(
        new RegExp(REASON),
      ),
    );
    fireEvent.click(del);
    expect(remove.sent).toHaveLength(0);
    await expectNoA11yViolations(container);
  });

  it("takes its box from the kit's icon button like the edit control, the same in every phase", async () => {
    const { remove, redraw } = mount("hold");
    const rest = deleteButton().getAttribute("style") ?? "";
    const pencilStyle =
      screen.getAllByRole("button")[0].getAttribute("style") ?? "";
    expect(pencilStyle).toBe(rest);
    fireEvent.click(deleteButton());
    await act(async () => {});
    redraw();
    expect(deleteButton().getAttribute("style") ?? "").toBe(rest);
    act(() => {
      remove.refuse(REASON);
    });
    await act(async () => {});
    redraw();
    expect(deleteButton().getAttribute("style") ?? "").toBe(rest);
  });
});

describe("NodeRow edit control beside the delete control", () => {
  it("is sized like the delete control, and does not move in any phase of the delete", async () => {
    const { remove, redraw } = mount("hold");
    const pencil = () => screen.getAllByRole("button")[0];
    const del = () => screen.getAllByRole("button").at(-1) as HTMLElement;
    const box = (el: HTMLElement) => el.getAttribute("style") ?? "";
    expect(box(pencil())).toBe(box(del()));
    const before = box(pencil());
    const parent = pencil().parentElement;
    const phases: Array<() => void> = [
      () => fireEvent.click(del()),
      () => {
        act(() => {
          remove.refuse(REASON);
        });
      },
    ];
    for (const step of phases) {
      step();
      await act(async () => {});
      redraw();
      expect(box(pencil())).toBe(before);
      expect(pencil().parentElement).toBe(parent);
      expect(del().previousElementSibling).toBe(pencil());
    }
  });

  it("keeps its size and position when the editor opens and closes", () => {
    mount("confirm");
    const pencil = screen.getAllByRole("button")[0];
    const boxOf = (el: HTMLElement) =>
      (el.getAttribute("style") ?? "")
        .split(";")
        .map((d) => d.trim())
        .filter((d) => d && !d.startsWith("background"))
        .join(";");
    const closed = boxOf(pencil);
    expect(pencil.getAttribute("aria-label")).toBe("Edit node");
    fireEvent.click(pencil);
    const open = screen.getByRole("button", { name: "Close editor" });
    expect(boxOf(open)).toBe(closed);
    expect(open.parentElement).toBe(pencil.parentElement);
  });
});
