import { registerTheme } from "@ksp-gonogo/core";
import { defaultDarkTheme } from "@ksp-gonogo/ui-kit";

export { defaultDarkTheme };

// Importing this module registers the built-in theme; the side effect stays out of the published kit.
registerTheme({
  id: "default-dark",
  name: "Default Dark",
  theme: defaultDarkTheme,
});
