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
 * here than for the other registries: a second copy of THIS one is a widget
 * registering into a Map the dashboard never reads, with no error anywhere, which
 * is the failure the shim design existed to prevent in the first place.
 *
 * The split below is not arbitrary. The sdk's ROOT barrel is the author-and-test
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
  unregisterDataSource,
} from "@ksp-gonogo/sitrep-sdk";
export {
  type AnyDef,
  type AnySource,
  getComponents,
  getReplacementConflicts,
  getResolvedComponents,
  onDataSourcesChange,
  type ReplacementConflict,
} from "@ksp-gonogo/sitrep-sdk/registry";

import { registerTheme as registerSdkTheme } from "@ksp-gonogo/sitrep-sdk";
import {
  getTheme as getSdkTheme,
  getThemes as getSdkThemes,
} from "@ksp-gonogo/sitrep-sdk/registry";
import type { ThemeDefinition } from "./types";

/**
 * The three theme functions are NARROWED here rather than re-exported, and that
 * is not a wart. The sdk's `ThemeDefinition.theme` is `unknown` because the sdk
 * cannot name `UiKitTheme`: `@ksp-gonogo/ui-kit` imports the sdk, so the edge back
 * would cycle. It is the same constraint that made the sdk's `testing/theme.ts`
 * ship a GENERATED copy of the theme values rather than importing them.
 *
 * So the sdk STORES a theme opaquely and this package, the first one that can see
 * both ends, is where it gets its type. Both halves need the narrowing for their
 * own reason: `ThemeProvider` needs the real shape on the way out or every
 * `theme.colors.*` read degrades to `unknown`, and re-exporting the sdk's
 * `registerTheme` on the way IN would silently widen every theme pack's argument
 * to `unknown`, throwing away the one check that catches a malformed pack.
 *
 * The read casts are sound because this wrapper is the only typed write path, and
 * a theme arriving through the sdk barrel instead was equally unchecked before the
 * move.
 */
export function registerTheme(def: ThemeDefinition): void {
  registerSdkTheme(def);
}

export function getThemes(): ThemeDefinition[] {
  return getSdkThemes() as ThemeDefinition[];
}

export function getTheme(id: string): ThemeDefinition | undefined {
  return getSdkTheme(id) as ThemeDefinition | undefined;
}
