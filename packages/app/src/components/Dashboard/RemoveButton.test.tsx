import { render, screen } from "@ksp-gonogo/test-utils";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RemoveButton } from "./shared";

describe("RemoveButton", () => {
  it("names the widget on the control", () => {
    render(<RemoveButton onRemove={() => {}} name="Altitude" />);
    expect(
      screen.getByRole("button", { name: "Remove Altitude" }),
    ).toBeInTheDocument();
  });

  it("asks with a labelled prompt and removes only on Remove", async () => {
    const onRemove = vi.fn();
    const user = userEvent.setup();
    const { container } = render(
      <RemoveButton onRemove={onRemove} name="Altitude" />,
    );
    await user.click(screen.getByRole("button", { name: "Remove Altitude" }));
    expect(
      screen.getByRole("group", { name: "Remove Altitude?" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("?")).toBeNull();
    expect(onRemove).not.toHaveBeenCalled();
    await expectNoA11yViolations(container);
    await user.click(screen.getByRole("button", { name: "Remove" }));
    expect(onRemove).toHaveBeenCalledOnce();
  });

  it("is keyboard operable: focus lands on Cancel, Escape returns to the control", async () => {
    const onRemove = vi.fn();
    const user = userEvent.setup();
    render(<RemoveButton onRemove={onRemove} name="Altitude" />);
    screen.getByRole("button", { name: "Remove Altitude" }).focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(
      screen.getByRole("button", { name: "Remove Altitude" }),
    ).toHaveFocus();
    await user.keyboard("{Enter}");
    await user.tab({ shift: true });
    expect(screen.getByRole("button", { name: "Remove" })).toBeInTheDocument();
    await user.keyboard("{Enter}");
    expect(onRemove).toHaveBeenCalledOnce();
  });

  it("Cancel keeps the widget and restores the control", async () => {
    const onRemove = vi.fn();
    const user = userEvent.setup();
    render(<RemoveButton onRemove={onRemove} name="Altitude" />);
    await user.click(screen.getByRole("button", { name: "Remove Altitude" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onRemove).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Remove Altitude" }),
    ).toHaveFocus();
  });
});
