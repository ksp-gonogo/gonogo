// Type-level tests for the generated unit vocabulary.
//
// Enforced by `tsc` via `tsconfig.test-d.json`, same as `topics.test-d.ts` and for
// the same reason: vitest 4's `expectTypeOf` is unreliable in this workspace, so a
// direct compiler pass is the gate. Runtime behaviour lives in `units.test.ts`.
//
// What is being pinned here is one asymmetry. `KnownSitrepUnit` is CLOSED, because
// every token in it came out of `Sitrep.Contract.Units` and the codegen throws on
// anything that did not. `SitrepUnit` is OPEN, because a third-party Uplink cannot
// add to that catalog: `Units` is a const-string class compiled into the contract
// assembly, so a closed `SitrepUnit` would have meant an Uplink could never declare
// a unit at all.
//
// Both halves need holding. Closing `SitrepUnit` breaks third parties; letting
// `KnownSitrepUnit` drift open silently loses the typo-safety that the catalog check
// buys first-party payloads.

import type { KnownSitrepUnit, SitrepUnit } from "./units";

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type Expect<T extends true> = T;

// ── The known arm stays closed ──────────────────────────────────────────────────────
export const _acceptsCatalogToken: KnownSitrepUnit = "m/s";

// @ts-expect-error: not a Sitrep.Contract.Units constant, so not in the known arm
export const _rejectsForeignToken: KnownSitrepUnit = "widgets/fortnight";

// @ts-expect-error: a typo in first-party code is still a compile error
export const _rejectsTypo: KnownSitrepUnit = "m/sec";

// ── The declared-unit type is open, so an Uplink can name its own ───────────────────
// This is the line that would fail if anyone "tidied" SitrepUnit back to a closed
// union. It is not laxness: it is the seam third parties extend through.
export const _acceptsUplinkToken: SitrepUnit = "widgets/fortnight";
export const _acceptsElectricCharge: SitrepUnit = "EC/s";

// Open, but not `string`: the known tokens survive as literals, which is what keeps
// autocomplete useful and makes `(string & {})` the right shape rather than a plain
// widening to `string`.
type Not<T extends boolean> = T extends true ? false : true;
export type _KnownIsNotString = Expect<Not<Equal<KnownSitrepUnit, string>>>;
export const _stillNarrowsLiterals: SitrepUnit = "K";

// A unit is a string, so a caller can always print one it does not recognise.
export const _isPrintable: string = _acceptsUplinkToken;
