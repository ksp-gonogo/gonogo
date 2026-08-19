import { render, screen, waitFor } from "@ksp-gonogo/sitrep-sdk/testing";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ActionMenu, type ActionMenuItem } from "./ActionMenu";

const ITEMS: ActionMenuItem[] = [
  { key: "a", label: "Alpha" },
  { key: "b", label: "Bravo" },
  { key: "c", label: "Charlie", disabled: true },
];

function renderMenu(overrides?: {
  items?: ActionMenuItem[];
  onSelect?: (key: string) => void;
  onDismiss?: () => void;
}) {
  const onSelect = overrides?.onSelect ?? vi.fn();
  const onDismiss = overrides?.onDismiss ?? vi.fn();
  const view = render(
    <ActionMenu
      items={overrides?.items ?? ITEMS}
      onSelect={onSelect}
      onDismiss={onDismiss}
      ariaLabel="Test actions"
    />,
  );
  return { onSelect, onDismiss, view };
}

describe("ActionMenu", () => {
  it("focuses the first item on open so the keyboard path starts inside the menu", async () => {
    renderMenu();

    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("menuitem", { name: "Alpha" }),
      ),
    );
  });

  it("walks items with ArrowDown/ArrowUp and clamps at the ends", async () => {
    const user = userEvent.setup();
    renderMenu();
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("menuitem", { name: "Alpha" }),
      ),
    );

    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(
      screen.getByRole("menuitem", { name: "Bravo" }),
    );

    // Clamps rather than wrapping: ArrowUp twice from the second item stays put.
    await user.keyboard("{ArrowUp}{ArrowUp}");
    expect(document.activeElement).toBe(
      screen.getByRole("menuitem", { name: "Alpha" }),
    );
  });

  it("jumps to the ends with Home/End", async () => {
    const user = userEvent.setup();
    renderMenu();
    await waitFor(() => expect(screen.getByRole("menu")).toBeTruthy());

    await user.keyboard("{End}");
    expect(document.activeElement).toBe(
      screen.getByRole("menuitem", { name: "Charlie" }),
    );
    await user.keyboard("{Home}");
    expect(document.activeElement).toBe(
      screen.getByRole("menuitem", { name: "Alpha" }),
    );
  });

  it("dismisses on Escape", async () => {
    const user = userEvent.setup();
    const { onDismiss } = renderMenu();
    await waitFor(() => expect(screen.getByRole("menu")).toBeTruthy());

    await user.keyboard("{Escape}");

    expect(onDismiss).toHaveBeenCalled();
  });

  it("dismisses on Tab rather than trapping focus", async () => {
    const user = userEvent.setup();
    const { onDismiss } = renderMenu();
    await waitFor(() => expect(screen.getByRole("menu")).toBeTruthy());

    await user.keyboard("{Tab}");

    expect(onDismiss).toHaveBeenCalled();
  });

  it("fires an enabled item and never a disabled one", async () => {
    const user = userEvent.setup();
    const { onSelect } = renderMenu();

    await user.click(screen.getByRole("menuitem", { name: "Bravo" }));
    expect(onSelect).toHaveBeenCalledWith("b");

    onSelect.mockClear?.();
    await user.click(screen.getByRole("menuitem", { name: "Charlie" }));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("shows group headers only when there is more than one group", async () => {
    const { view } = renderMenu({
      items: [
        { key: "a", label: "Alpha", group: "Solar" },
        { key: "b", label: "Bravo", group: "Antenna" },
      ],
    });
    await waitFor(() => expect(screen.getByRole("menu")).toBeTruthy());
    expect(view.container.textContent).toContain("Solar");
    expect(view.container.textContent).toContain("Antenna");

    // A single bucket renders flat: one header naming every item is noise.
    const single = render(
      <ActionMenu
        items={[{ key: "a", label: "Alpha" }]}
        onSelect={vi.fn()}
        onDismiss={vi.fn()}
        ariaLabel="Single"
      />,
    );
    expect(single.container.textContent).not.toContain("Other");
  });

  it("focuses the first item once an async list arrives after opening", async () => {
    // The PAW case: the menu opens before its actions have travelled, so focus
    // has to land when they show up, not only on mount.
    const { view } = renderMenu({ items: [] });
    expect(screen.getByText("No actions")).toBeTruthy();

    view.rerender(
      <ActionMenu
        items={[{ key: "a", label: "Alpha" }]}
        onSelect={vi.fn()}
        onDismiss={vi.fn()}
        ariaLabel="Test actions"
      />,
    );

    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("menuitem", { name: "Alpha" }),
      ),
    );
  });
});
