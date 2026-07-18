// Compat shim — `DataKeyPicker` now lives in `@ksp-gonogo/ui-kit` so
// export-safe third-party Uplink clients can use it without depending on
// this package. Re-exported here unchanged so in-tree consumers of
// `@ksp-gonogo/ui` keep compiling. A later migration phase removes this file.
export {
  DataKeyPicker,
  type DataKeyPickerProps,
  type KeyOption,
} from "@ksp-gonogo/ui-kit";
