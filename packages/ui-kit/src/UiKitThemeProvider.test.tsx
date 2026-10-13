import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { registerTheme, type UiKitTheme } from "@ksp-gonogo/sitrep-sdk";
import { getTheme } from "@ksp-gonogo/sitrep-sdk/registry";
import { render } from "@ksp-gonogo/sitrep-sdk/testing";
import {
  defaultDarkTheme,
  THEME_VARIABLE_NAMES,
  UiKitThemeProvider,
} from "@ksp-gonogo/theme";
import { useTheme } from "styled-components";
import { describe, expect, it } from "vitest";

const DAYLIGHT: UiKitTheme = {
  colors: {
    ...defaultDarkTheme.colors,
    text: { ...defaultDarkTheme.colors.text, primary: "#102030" },
    surface: { ...defaultDarkTheme.colors.surface, panel: "#f4f1ea" },
  },
  typography: {
    ...defaultDarkTheme.typography,
    size: { ...defaultDarkTheme.typography.size, base: "17px" },
  },
};

registerTheme({ id: "daylight-probe", name: "Daylight", theme: DAYLIGHT });

const rootVariable = (name: string) =>
  document.documentElement.style.getPropertyValue(name);

function PrimaryText() {
  return <output>{useTheme().colors.text.primary}</output>;
}

function mount(id: string) {
  const def = getTheme(id);
  if (!def) throw new Error(`no theme ${id}`);
  return (
    <UiKitThemeProvider theme={def.theme}>{<PrimaryText />}</UiKitThemeProvider>
  );
}

describe("UiKitThemeProvider", () => {
  it("writes a registered theme onto the variables the kit draws from, and takes them back on a switch", () => {
    const { rerender, getByRole, unmount } = render(
      <UiKitThemeProvider theme={defaultDarkTheme}>
        <PrimaryText />
      </UiKitThemeProvider>,
    );
    // The default theme names its own variables, so it writes nothing and tokens.css stays in charge.
    expect(rootVariable("--color-text-primary")).toBe("");

    rerender(mount("daylight-probe"));
    expect(rootVariable("--color-text-primary")).toBe("#102030");
    expect(rootVariable("--color-surface-panel")).toBe("#f4f1ea");
    expect(rootVariable("--font-size-base")).toBe("17px");
    expect(getByRole("status")).toHaveTextContent("#102030");

    rerender(
      <UiKitThemeProvider theme={defaultDarkTheme}>
        <PrimaryText />
      </UiKitThemeProvider>,
    );
    expect(rootVariable("--color-text-primary")).toBe("");
    expect(rootVariable("--font-size-base")).toBe("");

    rerender(mount("daylight-probe"));
    unmount();
    expect(rootVariable("--color-text-primary")).toBe("");
  });

  it("only sets variables that tokens.css declares", () => {
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
    expect(THEME_VARIABLE_NAMES.filter((name) => !declared.has(name))).toEqual(
      [],
    );
  });
});
