import { registerTheme } from "@ksp-gonogo/core";
import { defaultDarkTheme, type UiKitTheme } from "@ksp-gonogo/ui-kit";

/** The default colours with the sizes, spacing, corners, edges, weights and motion pulled in. */
export const dense: UiKitTheme = {
  ...defaultDarkTheme,
  typography: {
    ...defaultDarkTheme.typography,
    size: { xs: "10px", sm: "11px", base: "12px", lg: "14px" },
    microSize: "9px",
    lineHeight: { flush: "1", tight: "1.1", body: "1.25", prose: "1.35" },
    iconSize: { control: "12px", standalone: "16px" },
    weight: { semibold: "500", bold: "600" },
    tracking: 0.5,
  },
  radius: {
    regular: "0px",
    floating: "2px",
    displayFrame: "2px",
    displayFrameAside: "0px",
  },
  space: {
    hair: "1px",
    "2": "1px",
    "4": "2px",
    "6": "3px",
    "8": "4px",
    "10": "5px",
    "12": "6px",
    "16": "8px",
    "24": "12px",
  },
  sizes: { controlHeight: "20px", fab: "36px" },
  density: {
    related: {
      comfortable: "4px",
      compact: "3px",
      dense: "2px",
      packed: "1px",
    },
    section: { comfortable: "8px", compact: "6px" },
    panelGutter: "6px",
    screenGutter: "8px",
    control: "2px 6px",
    surface: "3px 4px",
  },
  floating: { padding: "6px" },
  elevation: { floating: { offset: "3px", blur: "8px" } },
  borderWidth: { hairline: "0.5px", strong: "1px" },
  motion: { speed: 0.6 },
};

registerTheme({ id: "dense", name: "Dense", theme: dense });
