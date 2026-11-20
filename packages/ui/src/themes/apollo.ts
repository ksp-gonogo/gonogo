import { registerTheme } from "@ksp-gonogo/core";
import { defaultDarkTheme, type UiKitTheme } from "@ksp-gonogo/ui-kit";

/** A 1960s flight-control console: olive-grey metal, cream legends, square corners, engraved edges, a typewriter face and relay-stepped motion. */
export const apollo: UiKitTheme = {
  ...defaultDarkTheme,
  colors: {
    ...defaultDarkTheme.colors,
    text: {
      primary: "#f1e7c6",
      muted: "#cbbf9d",
      dim: "#bdb18f",
      faint: "#b3a784",
      inverse: "#1a1c16",
    },
    surface: {
      app: "#0f110c",
      panel: "#13160f",
      raised: "#22261d",
      sunken: "#0d0f0a",
    },
    border: { subtle: "#4d5342", strong: "#7a8066" },
    accent: { fg: "#ffb000", bg: "#ffb000" },
    focus: "#ffb000",
    status: {
      go: "#6cc04a",
      nogo: "#ff6a3d",
      warn: "#ffb000",
      info: "#9fd8e8",
    },
    palette: { go3: "#33601f", onFill: "#1a1c16" },
    shadow: "#0a0b08",
  },
  typography: {
    ...defaultDarkTheme.typography,
    family: {
      mono: '"Courier New", Courier, "Liberation Mono", monospace',
    },
    tracking: 1.4,
  },
  radius: {
    regular: "0px",
    floating: "0px",
    banner: "0px",
    displayFrame: "0px",
    displayFrameAside: "0px",
  },
  elevation: { floating: { offset: "0px", blur: "0px" } },
  borderWidth: { hairline: "2px", strong: "3px" },
  motion: { speed: 0.7, standard: "steps(3, end)", emphasis: "steps(3, end)" },
};

registerTheme({ id: "apollo", name: "Apollo", theme: apollo });
