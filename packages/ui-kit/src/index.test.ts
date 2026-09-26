import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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
import { GAP_VAR, INSET_NAME, RADIUS_VAR } from "./scales";

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

  it("resolves a spacing prop to a job's token rather than a raw length", () => {
    // The scales are the kit's own, off the theme contract, so nothing outside
    // this package can assert them through a public export.
    expect(GAP_VAR["related-comfortable"]).toBe(
      "var(--gap-related-comfortable)",
    );
    expect(INSET_NAME["chip-readout"]).toBe("--inset-chip-readout");
    expect(RADIUS_VAR.regular).toBe("var(--radius-regular)");
    expect(RADIUS_VAR.pill).toBe("var(--radius-pill)");
  });

  it("points every size handle at a token the stylesheet declares", () => {
    /*
     * The mapping above is a string, and a string still matches after its
     * token is renamed or deleted. A `var()` naming nothing makes the whole
     * declaration invalid at computed-value time, so the gap or the corner
     * silently falls back to nothing and no render throws.
     */
    const tokens = readFileSync(
      resolve(
        dirname(fileURLToPath(import.meta.url)),
        "../../theme/src/tokens.css",
      ),
      "utf8",
    );
    const declared = new Set(
      [...tokens.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gm)].map((m) => m[1]),
    );
    const handles = {
      ...GAP_VAR,
      ...RADIUS_VAR,
      ...Object.fromEntries(
        Object.entries(INSET_NAME).map(([key, name]) => [key, `var(${name})`]),
      ),
    };
    const undeclared = Object.entries(handles).filter(([, handle]) => {
      const name = /^var\((--[a-z0-9-]+)\)$/.exec(handle)?.[1];
      return name === undefined || !declared.has(name);
    });
    expect(undeclared).toEqual([]);
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
