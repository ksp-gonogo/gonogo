import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { registerTheme, type UiKitTheme } from "@ksp-gonogo/sitrep-sdk";
import { getTheme } from "@ksp-gonogo/sitrep-sdk/registry";
import { render } from "@ksp-gonogo/sitrep-sdk/testing";
import {
  defaultDarkTheme,
  THEME_VARIABLE_NAMES,
  themeVariables,
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

describe("a theme's status colours", () => {
  const withStatus = (
    status: NonNullable<UiKitTheme["colors"]["status"]>,
    palette: UiKitTheme["colors"]["palette"] = defaultDarkTheme.colors.palette,
  ): UiKitTheme => ({
    ...defaultDarkTheme,
    colors: { ...defaultDarkTheme.colors, status, palette },
  });

  it("derives every step of a tone from its one colour, against the theme's own text and panel", () => {
    const written = themeVariables(withStatus({ go: "#2a8a4a" }));
    expect(written["--status-go-2"]).toBe("#2a8a4a");
    expect(written["--status-go-1"]).toBe(
      "color-mix(in srgb, #2a8a4a 30%, var(--color-text-primary))",
    );
    expect(written["--status-go-4"]).toBe(
      "color-mix(in srgb, #2a8a4a 14%, var(--color-surface-panel))",
    );
    expect(written["--status-nogo-2"]).toBeUndefined();
  });

  it("lets a step set by name replace the derived one", () => {
    const written = themeVariables(
      withStatus({ go: "#2a8a4a" }, { go3: "#33601f" }),
    );
    expect(written["--status-go-3"]).toBe("#33601f");
    expect(written["--status-go-2"]).toBe("#2a8a4a");
  });

  it("derives caution's amber from warn, so the two cannot differ", () => {
    const written = themeVariables(withStatus({ warn: "#b35c00" }));
    expect(written["--status-warn-2"]).toBe("#b35c00");
    expect(Object.keys(written).filter((k) => k.includes("caution"))).toEqual(
      [],
    );
  });

  it("writes nothing for the default theme", () => {
    expect(themeVariables(defaultDarkTheme)).toEqual({});
  });
});

describe("the foundation layer of tokens.css", () => {
  const tokens = readFileSync(
    resolve(
      dirname(fileURLToPath(import.meta.url)),
      "../../theme/src/tokens.css",
    ),
    "utf8",
  ).replace(/\/\*[\s\S]*?\*\//g, "");

  const declarations = [
    ...tokens.matchAll(/^\s*(--[a-z0-9-]+)\s*:\s*([^;]+);/gm),
  ];
  const literals = new Set(
    declarations.filter((m) => !m[2].includes("var(")).map((m) => m[1]),
  );
  const derived = new Set(
    declarations.filter((m) => m[2].includes("var(")).map((m) => m[1]),
  );

  /** Literal variables no theme sets, each with the reason it is not a visual foundation value. */
  const NOT_THEMEABLE: Record<string, string> = {
    "--z-base": "stacking order",
    "--z-sticky": "stacking order",
    "--z-dropdown": "stacking order",
    "--z-overlay": "stacking order",
    "--z-fab": "stacking order",
    "--z-backdrop": "stacking order",
    "--z-modal": "stacking order",
    "--z-toast": "stacking order",
    "--z-critical": "stacking order",
    "--duration-instant": "motion",
    "--duration-fast": "motion",
    "--duration-base": "motion",
    "--duration-slow": "motion",
    "--duration-entrance": "motion",
    "--ease-linear": "motion",
    "--ease-entrance": "motion",
    "--radius-circle": "fully round, a shape and not a size",
    "--bleed-inline": "a layout reset a container overrides",
    "--touch-target": "the smallest pressable box on a coarse pointer",
    "--control-height-touch": "stepped by the coarse-pointer media query",
  };

  it("is covered by the theme: every literal variable is one a theme sets or is named as not themeable", () => {
    const settable = new Set(THEME_VARIABLE_NAMES);
    const uncovered = [...literals].filter(
      (name) => !settable.has(name) && !(name in NOT_THEMEABLE),
    );
    expect(uncovered).toEqual([]);
  });

  /** Derived sizes a theme may state outright, each one of the ten named spacing sizes or the floating padding. */
  const NAMED_SIZES = new Set([
    "--gap-related-comfortable",
    "--gap-related-compact",
    "--gap-related-dense",
    "--gap-related-packed",
    "--gap-section-comfortable",
    "--gap-section-compact",
    "--gutter-panel",
    "--gutter-screen",
    "--inset-control",
    "--inset-surface",
    "--inset-floating",
  ]);

  const isShadow = (name: string) => name.startsWith("--shadow-");

  it("keeps the semantic layer out of reach: no variable a theme sets is derived from another, bar the named sizes and shadows", () => {
    const reachable = THEME_VARIABLE_NAMES.filter(
      (name) => derived.has(name) && !NAMED_SIZES.has(name) && !isShadow(name),
    );
    expect(reachable).toEqual([]);
  });

  it("is mirrored by the default theme, which writes nothing", () => {
    expect(themeVariables(defaultDarkTheme)).toEqual({});
  });

  it("writes only foundation variables, whatever a theme is given", () => {
    const loud: UiKitTheme = {
      ...JSON.parse(
        JSON.stringify(defaultDarkTheme).replace(
          /var\(--[a-z0-9-]+\)/g,
          "#123",
        ),
      ),
      elevation: {
        raised: { offset: "1px", blur: "2px" },
        floating: { offset: "4px", blur: "12px" },
      },
    };
    loud.density = { ...loud.density, control: "1px", surface: "1px" };
    loud.typography.tracking = 2;
    loud.motion = { ...loud.motion, speed: 2 };
    const written = Object.keys(themeVariables(loud));
    expect(written.sort()).toEqual([...THEME_VARIABLE_NAMES].sort());
    expect(
      written.filter(
        (name) =>
          derived.has(name) && !NAMED_SIZES.has(name) && !isShadow(name),
      ),
    ).toEqual([]);
  });
});

describe("a theme's density, elevation, borders and motion", () => {
  const base = defaultDarkTheme;

  it("keeps a smaller density tier no larger than the one above, whatever it is given", () => {
    const written = themeVariables({
      ...base,
      density: { related: { compact: "20px", dense: "30px" } },
    });
    expect(written["--gap-related-compact"]).toBe(
      "min(20px, var(--gap-related-comfortable))",
    );
    expect(written["--gap-related-dense"]).toBe(
      "min(30px, var(--gap-related-compact))",
    );
  });

  it("writes a named size outright and leaves out one it is not given", () => {
    const written = themeVariables({
      ...base,
      density: { control: "3px 6px", panelGutter: "8px" },
      floating: { padding: "6px" },
    });
    expect(written["--inset-control"]).toBe("3px 6px");
    expect(written["--gutter-panel"]).toBe("8px");
    expect(written["--inset-floating"]).toBe("6px");
    expect(written["--gutter-screen"]).toBeUndefined();
  });

  it("draws a raised shadow no larger than the floating one", () => {
    const written = themeVariables({
      ...base,
      elevation: {
        raised: { offset: "6px", blur: "40px" },
        floating: { offset: "4px", blur: "12px" },
      },
    });
    expect(written["--shadow-raised"]).toBe(
      "0 min(6px, 4px) min(40px, 12px) color-mix(in srgb, var(--color-shadow) 55%, transparent)",
    );
    expect(written["--shadow-modal"]).toBe(
      "0 4px 12px color-mix(in srgb, var(--color-shadow) 55%, transparent)",
    );
  });

  it("writes border widths, weights, tracking and motion, and nothing at their defaults", () => {
    const written = themeVariables({
      ...base,
      borderWidth: { hairline: "2px" },
      typography: {
        ...base.typography,
        weight: { bold: "800" },
        tracking: 1.5,
      },
      motion: { speed: 0.5, standard: "steps(4)" },
    });
    expect(written).toMatchObject({
      "--border-width-hairline": "2px",
      "--font-weight-bold": "800",
      "--tracking-scale": "1.5",
      "--motion-speed": "0.5",
      "--ease-standard": "steps(4)",
    });
    expect(
      themeVariables({
        ...base,
        typography: { ...base.typography, tracking: 1 },
        motion: { speed: 1 },
      }),
    ).toEqual({});
  });
});
