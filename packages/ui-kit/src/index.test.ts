import { describe, expect, it } from "vitest";
import {
  ArrowLeftIcon,
  ArrowUpIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CloseIcon,
  ConfigForm,
  DataKeyPicker,
  defaultDarkTheme,
  Field,
  FieldHint,
  FieldLabel,
  GhostButton,
  Input,
  PrimaryButton,
  Switch,
  Textarea,
  useElementSize,
  useModalSaveBar,
} from "./index";
import { RADIUS_VAR, SPACE_VAR } from "./scales";

describe("ui-kit foundation", () => {
  it("exports a default-dark theme satisfying the token contract", () => {
    expect(defaultDarkTheme.colors.text.primary).toBe(
      "var(--color-text-primary)",
    );
    expect(defaultDarkTheme.colors.accent.fg).toBe("var(--color-accent-fg)");
    expect(defaultDarkTheme.colors.focus).toBe("var(--color-focus)");
  });

  it("carries the extended token scales the primitives depend on", () => {
    expect(defaultDarkTheme.typography.letterSpacing.tight).toBe("0.05em");
    expect(defaultDarkTheme.typography.letterSpacing.label).toBe("0.1em");
    expect(defaultDarkTheme.typography.letterSpacing.wide).toBe("0.15em");
  });

  it("resolves a size prop to a token handle rather than a raw length", () => {
    // The scales are the kit's own, off the theme contract, so nothing outside
    // this package can assert them through a public export.
    expect(SPACE_VAR.md).toBe("var(--space-8)");
    expect(SPACE_VAR.xs).toBe("var(--space-2)");
    expect(RADIUS_VAR.regular).toBe("var(--radius-regular)");
    expect(RADIUS_VAR.pill).toBe("var(--radius-pill)");
  });

  it("exports the form-primitive + icon surface moved from @ksp-gonogo/ui", () => {
    // Form primitives
    expect(ConfigForm).toBeDefined();
    expect(Field).toBeDefined();
    expect(FieldHint).toBeDefined();
    expect(FieldLabel).toBeDefined();
    expect(Input).toBeDefined();
    expect(Textarea).toBeDefined();
    expect(Switch).toBeDefined();
    expect(DataKeyPicker).toBeDefined();

    // Hook
    expect(typeof useModalSaveBar).toBe("function");

    // Buttons
    expect(GhostButton).toBeDefined();
    expect(PrimaryButton).toBeDefined();

    // Icons
    expect(ArrowLeftIcon).toBeDefined();
    expect(ArrowUpIcon).toBeDefined();
    expect(ChevronDownIcon).toBeDefined();
    expect(ChevronRightIcon).toBeDefined();
    expect(CheckIcon).toBeDefined();
    expect(CloseIcon).toBeDefined();

    // Layout hook
    expect(typeof useElementSize).toBe("function");
  });
});
