/**
 * The settings React context moved to `@ksp-gonogo/sitrep-sdk` with the service it
 * carries: see `./SettingsService.ts`. A context is the one thing a second copy
 * breaks silently, since a provider from one copy is invisible to a consumer of
 * the other, so it has to sit in the single published package both sides resolve.
 *
 * That also retires `useSetting`'s host shim. It was a shim so an Uplink's hook
 * would read the app's context rather than a bundled copy of it; with one context
 * in one published package, there is no second copy to read.
 *
 * Re-exported so this package's importers keep their import site.
 */
export {
  SettingsProvider,
  useSetting,
  useSettingsService,
} from "@ksp-gonogo/sitrep-sdk";
