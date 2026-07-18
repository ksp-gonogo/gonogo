import { render, screen } from "@ksp-gonogo/test-utils";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { Input } from "./Form";

describe("Form.Input", () => {
  it("is reachable by keyboard Tab", async () => {
    const user = userEvent.setup();
    render(
      <>
        <button type="button">before</button>
        <Input aria-label="telemetry" />
      </>,
    );
    await user.tab();
    expect(screen.getByText("before")).toHaveFocus();
    await user.tab();
    expect(screen.getByLabelText("telemetry")).toHaveFocus();
  });
});
