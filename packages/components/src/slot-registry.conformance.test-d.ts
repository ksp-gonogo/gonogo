/**
 * Drift guard for the two widget scopes still declared in this package as well as in
 * `@ksp-gonogo/sitrep-sdk`: the sdk declares them but does not export them by name, so this package
 * keeps its own copy. Checked both ways, so a change to either side fails typecheck.
 */

import type { WidgetScope as SdkWidgetScope } from "@ksp-gonogo/sitrep-sdk";
import type { MapViewScope } from "./MapView";
import type { PowerSystemsScope } from "./PowerSystems";

type Assignable<Left, Right> = Left extends Right ? true : false;
type Expect<Condition extends true> = Condition;

type _MapViewScope = Expect<
  Assignable<SdkWidgetScope<"map-view">, MapViewScope>
>;
type _MapViewScopeBack = Expect<
  Assignable<MapViewScope, SdkWidgetScope<"map-view">>
>;
type _PowerScope = Expect<
  Assignable<SdkWidgetScope<"power-systems">, PowerSystemsScope>
>;
type _PowerScopeBack = Expect<
  Assignable<PowerSystemsScope, SdkWidgetScope<"power-systems">>
>;
