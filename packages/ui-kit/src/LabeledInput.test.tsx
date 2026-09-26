import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { LabeledInput } from "./LabeledInput";

function Controlled({ onChange }: { onChange: (n: number) => void }) {
  const [value, setValue] = useState(120);
  return (
    <LabeledInput
      label="Prograde"
      value={value}
      onChange={(n) => {
        onChange(n);
        setValue(n);
      }}
    />
  );
}

describe("LabeledInput", () => {
  it("can be cleared and retyped without committing a zero nobody entered", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Controlled onChange={onChange} />);
    const field = screen.getByRole("spinbutton", {
      name: /Prograde/,
    }) as HTMLInputElement;
    await user.clear(field);
    expect(onChange).not.toHaveBeenCalledWith(0);
    expect(field.value).toBe("");
    await user.type(field, "45");
    expect(onChange).toHaveBeenLastCalledWith(45);
    expect(field.value).toBe("45");
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <LabeledInput label="Prograde" value={12} onChange={() => {}} />,
    );
    await expectNoA11yViolations(container);
  });
});
