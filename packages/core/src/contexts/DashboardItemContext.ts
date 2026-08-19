/**
 * The dashboard-item context moved to `@ksp-gonogo/sitrep-sdk`.
 *
 * `useActionInput` reads the instance id out of it, and that hook is an Uplink's
 * only way to handle its own declared actions, so the context has to be reachable
 * from a published package or a widget cannot be tested outside this repo. It
 * names nothing but React.
 *
 * Re-exported so this package's importers keep their import site.
 */
export {
  DashboardItemContext,
  type DashboardItemContextValue,
  useDashboardItemId,
} from "@ksp-gonogo/sitrep-sdk/spine";
