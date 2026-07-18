// Compat shim — `configEqual` now lives in `@ksp-gonogo/ui-kit` (needed
// there by `useModalSaveBar`). Re-exported here unchanged so in-tree
// consumers of `@ksp-gonogo/ui` keep compiling. A later migration phase
// removes this file.
export { configEqual } from "@ksp-gonogo/ui-kit";
