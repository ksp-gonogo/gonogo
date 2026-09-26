/*
 * Type-level proof that `Instrument` is a structural projection of the
 * `science.instruments` wire type. Checked by `tsc` via `tsconfig.test-d.json`.
 * Fields renamed on the wire other than `hasData` are covered by the parser tests.
 */

import type { Instrument, WireInstrument } from "./instrument";

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type Expect<T extends true> = T;

type _PartIdCompatible = Expect<
  Equal<NonNullable<WireInstrument["partId"]>, Instrument["partId"]>
>;
type _DeployedCompatible = Expect<
  Equal<NonNullable<WireInstrument["deployed"]>, Instrument["deployed"]>
>;
type _InoperableCompatible = Expect<
  Equal<NonNullable<WireInstrument["inoperable"]>, Instrument["inoperable"]>
>;
type _RerunnableCompatible = Expect<
  Equal<NonNullable<WireInstrument["rerunnable"]>, Instrument["rerunnable"]>
>;
// `hasData` is the wire's `dataIsCollectable`.
type _HasDataCompatible = Expect<
  Equal<NonNullable<WireInstrument["dataIsCollectable"]>, Instrument["hasData"]>
>;
