/**
 * The fog-of-war reveal-source registry moved to `@ksp-gonogo/sitrep-sdk`.
 *
 * An Uplink is the thing that contributes coverage to it, and registering was
 * already published as a host shim, but `clearFogRevealSources` was not, so an
 * Uplink's own tests could not reset the registry between cases without reaching
 * this package, which is `private: true`.
 *
 * It named `logger` (which the sdk routes through the host) and two types from
 * `@ksp-gonogo/ui-kit`. One of those, `AugmentSettingField`, was already the sdk's
 * with ui-kit re-exporting; the other, `NamespacedAugmentSettings`, moved the same
 * way in this change, since it is a shape over the first and this registry's
 * settings read returns it. ui-kit imports the sdk, so the sdk end is the only end
 * both packages can share a declaration from.
 *
 * Re-exported so this package's importers keep their import site.
 */
export {
  clearFogRevealSources,
  type FogRevealSourceDefinition,
  getFogRevealSourceSettings,
  getFogRevealSources,
  onFogRevealSourcesChange,
  registerFogRevealSource,
  unregisterFogRevealSource,
} from "@ksp-gonogo/sitrep-sdk";
