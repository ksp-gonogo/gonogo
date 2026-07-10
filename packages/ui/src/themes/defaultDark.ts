import { registerTheme } from "@ksp-gonogo/core";
import { defaultDarkTheme } from "@ksp-gonogo/ui-kit";

// Re-exported so `ui/index.ts`'s `export *` keeps its existing surface.
export { defaultDarkTheme };

// Registration is a side effect and belongs in `@ksp-gonogo/ui` (not the
// export-safe kit). Importing this module registers the built-in theme.
registerTheme({
  id: "default-dark",
  name: "Default Dark",
  theme: defaultDarkTheme,
});
