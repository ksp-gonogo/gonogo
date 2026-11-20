import { registerTheme } from "@ksp-gonogo/core";
import { defaultDarkTheme, type UiKitTheme } from "@ksp-gonogo/ui-kit";

/** Black and white with saturated hues, square corners, and heavy edges and type. A shadow cannot show on black, so a floating box is set apart by its edge. */
export const highContrast: UiKitTheme = {
  ...defaultDarkTheme,
  colors: {
    ...defaultDarkTheme.colors,
    text: {
      primary: "#ffffff",
      muted: "#e6e6e6",
      dim: "#d6d6d6",
      faint: "#c8c8c8",
      inverse: "#000000",
    },
    surface: {
      app: "#000000",
      panel: "#000000",
      raised: "#1c1c1c",
      sunken: "#000000",
    },
    border: { subtle: "#9a9a9a", strong: "#ffffff" },
    accent: { fg: "#ffff00", bg: "#ffff00" },
    focus: "#00ffff",
    status: {
      go: "#00e060",
      nogo: "#ff5c5c",
      warn: "#ffb000",
      info: "#6adfff",
    },
    palette: { onFill: "#000000" },
  },
  typography: {
    ...defaultDarkTheme.typography,
    weight: { semibold: "700", bold: "800" },
    tracking: 1.25,
  },
  radius: {
    ...defaultDarkTheme.radius,
    regular: "0px",
    floating: "0px",
  },
  borderWidth: { hairline: "2px", strong: "3px" },
};

registerTheme({
  id: "high-contrast",
  name: "High Contrast",
  theme: highContrast,
});
