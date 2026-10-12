/**
 * The component / data-source / theme registry moved to
 * `@ksp-gonogo/sitrep-sdk`.
 *
 * It was the last place the injected-host story did not hold up. Registration was
 * published as a shim, so an Uplink could add a widget; nothing else about the
 * registry was, so the same Uplink had no supported way to reset it between test
 * cases (18 Uplink files call `clearRegistry`) or read back what it had added
 * (`getComponent`, `getDataSource`). Every one of them imported this package,
 * which is `private: true`.
 *
 * It named `logger` and three types, and both had somewhere to go: the sdk already
 * routes logging through the host, and the three types were already on its type
 * surface. So the registry moves outright and the two host members retire.
 *
 * Its state moved to a `globalThis` slot in the same change, and that matters more
 * here than for the other registries: a second copy of this one is a widget
 * registering into a Map the dashboard never reads, with no error anywhere, which
 * is the failure the shim design existed to prevent in the first place.
 *
 * The split below is not arbitrary. The sdk's root barrel is the author-and-test
 * surface; `/registry` is the orchestration half, which an Uplink author has no
 * business calling and which is therefore kept off the published author surface.
 * Both re-export from one module, so there is still one registry.
 */
export {
  clearRegistry,
  getComponent,
  getDataSource,
  getDataSources,
  registerComponent,
  registerDataSource,
  registerTheme,
  unregisterDataSource,
} from "@ksp-gonogo/sitrep-sdk";
export {
  type AnyDef,
  type AnySource,
  getComponents,
  getReplacementConflicts,
  getResolvedComponents,
  getTheme,
  getThemes,
  type ReplacementConflict,
} from "@ksp-gonogo/sitrep-sdk/registry";
