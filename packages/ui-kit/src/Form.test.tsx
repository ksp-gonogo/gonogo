import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import {
  ConfigForm,
  Field,
  FieldHint,
  FieldLabel,
  FormActions,
  Input,
  Select,
  Textarea,
} from "./Form";

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

  it("draws the kit focus ring on every field control", () => {
    render(
      <>
        <Input aria-label="a" />
        <Select aria-label="b" />
        <Textarea aria-label="c" />
      </>,
    );
    const sheet = [...document.querySelectorAll("style")]
      .map((style) => style.textContent ?? "")
      .join("");
    for (const name of ["a", "b", "c"]) {
      const generated = [...screen.getByLabelText(name).classList].filter(
        (c) => !c.startsWith("sc-"),
      );
      expect(
        generated.some((c) =>
          sheet.includes(
            `.${c}:focus-visible{outline:2px solid var(--color-focus)`,
          ),
        ),
      ).toBe(true);
    }
  });
});

describe("Form", () => {
  it("has no axe violations as a labelled form", async () => {
    const { container } = render(
      <ConfigForm $boxed>
        <Field>
          <FieldLabel htmlFor="host">Host</FieldLabel>
          <Input id="host" />
          <FieldHint>Where the mod listens</FieldHint>
        </Field>
        <Field>
          <FieldLabel htmlFor="mode">Mode</FieldLabel>
          <Select id="mode">
            <option>Live</option>
          </Select>
        </Field>
        <Field>
          <FieldLabel htmlFor="notes">Notes</FieldLabel>
          <Textarea id="notes" />
        </Field>
        <FormActions>
          <button type="button">Save</button>
        </FormActions>
      </ConfigForm>,
    );
    await expectNoA11yViolations(container);
  });
});
