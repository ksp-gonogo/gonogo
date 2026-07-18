// Compat shim — buttons now live in `@ksp-gonogo/ui-kit` so export-safe
// third-party Uplink clients can use them without depending on this package.
// Re-exported here unchanged so in-tree consumers of `@ksp-gonogo/ui` keep
// compiling. A later migration phase removes this file.
export {
  Button,
  GhostButton,
  IconButton,
  PrimaryButton,
  TextButton,
} from "@ksp-gonogo/ui-kit";
