/**
 * `useDataSourceSubscription` moved to `@ksp-gonogo/sitrep-sdk`.
 *
 * The scaffolding `useTelemetry` reads through, so it had to travel with it. It
 * named the registry and the `DataSource` type, both already sdk-side.
 *
 * Re-exported so this package's importers keep their import site.
 */
export {
  type DataSourceSubscriptionSetup,
  useDataSourceSubscription,
} from "@ksp-gonogo/sitrep-sdk/spine";
