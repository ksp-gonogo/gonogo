import { render, screen } from "@ksp-gonogo/test-utils";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PowerSystemsConfigForm } from "./PowerSystemsConfigForm";

describe("PowerSystemsConfigForm", () => {
  it("labels the default resource field and starts on Electric Charge", () => {
    render(<PowerSystemsConfigForm config={{}} onSave={vi.fn()} />);
    expect(screen.getByLabelText("Default resource")).toHaveValue(
      "ElectricCharge",
    );
  });

  it("starts on the saved default resource", () => {
    render(
      <PowerSystemsConfigForm
        config={{ defaultResource: "LiquidFuel" }}
        onSave={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Default resource")).toHaveValue("LiquidFuel");
  });

  it("takes a typed resource name", async () => {
    const user = userEvent.setup();
    render(<PowerSystemsConfigForm config={{}} onSave={vi.fn()} />);
    const field = screen.getByLabelText("Default resource");

    await user.clear(field);
    await user.type(field, "Oxidizer");

    expect(field).toHaveValue("Oxidizer");
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <PowerSystemsConfigForm config={{}} onSave={vi.fn()} />,
    );
    await expectNoA11yViolations(container);
  });
});
