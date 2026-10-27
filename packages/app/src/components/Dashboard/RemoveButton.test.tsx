import { render, screen } from "@ksp-gonogo/test-utils";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RemoveButton } from "./shared";

describe("RemoveButton", () => {
  it("names the widget on the control", async () => {
    const { container } = render(
      <RemoveButton onRemove={() => {}} name="Altitude" />,
    );
    expect(
      screen.getByRole("button", { name: "Remove Altitude" }),
    ).toBeInTheDocument();
    await expectNoA11yViolations(container);
  });

  it("removes at once on a click, with no prompt", async () => {
    const onRemove = vi.fn();
    const user = userEvent.setup();
    render(<RemoveButton onRemove={onRemove} name="Altitude" />);
    await user.click(screen.getByRole("button", { name: "Remove Altitude" }));
    expect(onRemove).toHaveBeenCalledOnce();
    expect(screen.queryByRole("group")).toBeNull();
  });

  it("removes from the keyboard with Enter", async () => {
    const onRemove = vi.fn();
    const user = userEvent.setup();
    render(<RemoveButton onRemove={onRemove} name="Altitude" />);
    await user.tab();
    await user.keyboard("{Enter}");
    expect(onRemove).toHaveBeenCalledOnce();
  });
});
