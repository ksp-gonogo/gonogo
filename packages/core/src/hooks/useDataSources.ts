/**
 * `useDataSources` moved to `@ksp-gonogo/sitrep-sdk`.
 *
 * It named the data-source registry and the `DataSourceStatus` type, both already
 * sdk-side.
 *
 * Re-exported so this package's importers keep their import site.
 */
export {
  type DataSourceState,
  useDataSources,
} from "@ksp-gonogo/sitrep-sdk/spine";
