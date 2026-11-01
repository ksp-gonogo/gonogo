/*
 * A unit token that is invented, misspelt or missing fails to compile, and an
 * Uplink's own tokens join the accepted set by augmenting `UnitDeclarations`.
 */

import { staticValue, value } from "./value";

declare module "./declarations" {
  interface UnitDeclarations {
    "checked:crate": {
      kind: "checkedCrates";
      dim: { readonly crate: 1 };
      ratio: 1;
    };
  }
}

export const _declared = value("science/day", 1);
export const _declaredRate = value("m/s", 1);
export const _augmented = value("checked:crate", 3);
export const _staticDeclared = staticValue("m", 1);

// @ts-expect-error: no such unit
export const _invented = value("science/s", 1);
// @ts-expect-error: a misspelt unit
export const _misspelt = value("Klevin", 1);
// @ts-expect-error: a rate nobody declared
export const _undeclaredRate = value("m/zz", 1);
// @ts-expect-error: an undeclared namespaced token
export const _undeclaredNamespaced = value("other:crate", 1);
// @ts-expect-error: a token held only as a string cannot be checked
export const _wide = value("m" as string, 1);
// @ts-expect-error: the static twin is checked the same way
export const _staticInvented = staticValue("science/s", 1);
