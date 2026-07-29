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
  formatAge,
  formatAgeLong,
  GhostButton,
  Input,
  PrimaryButton,
  Switch,
  Textarea,
  useElementSize,
  useModalSaveBar,
} from "./index";

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
    // Handles onto the ladders, not values. These asserted raw px until the
    // theme stopped keeping its own copy of the numbers; the colours above
    // have always been asserted this way.
    expect(defaultDarkTheme.radii.xs).toBe("var(--radius-xs)");
    expect(defaultDarkTheme.radii.pill).toBe("var(--radius-pill)");
    expect(defaultDarkTheme.space.md).toBe("var(--space-8)");
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

    // Time formatters
    expect(typeof formatAge).toBe("function");
    expect(typeof formatAgeLong).toBe("function");
  });
});
