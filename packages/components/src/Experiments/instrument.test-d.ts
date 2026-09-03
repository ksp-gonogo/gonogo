// Type-level proof that `Instrument`, the shape this widget parses to, hands
// to `ScienceExperimentRow` and publishes as the `experiments.instruments`
// contribution entry, is a real structural projection of the SDK's wire type
// for the `science.instruments` topic: not a coincidentally similar shape. Enforced by `tsc` (the package `typecheck` script runs this
// via `tsconfig.test-d.json`), matching the SDK's own `topics.test-d.ts`
// decision (type-level tests don't belong in the vitest runner).
//
// `WireInstrument` (`InstrumentEntry`) is all-optional (wire uncertainty);
// `Instrument` is the normalised, already-parsed shape a widget hands
// down after its own `parseInstruments`. Two fields are renamed on the wire
// (`hasData` <- `dataIsCollectable`; `partTitle`/`expId` <- `partName`/
// `experimentId`, checked by the widget's own parser tests, not here), this
// file checks the fields that keep their name, plus the renamed `hasData`,
// each has a compatible (optional-widened) counterpart on the wire type.

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
// `hasData` maps onto the wire's `dataIsCollectable` (see the widget's
// `parseInstruments` doc comment): different name, same boolean shape.
type _HasDataCompatible = Expect<
  Equal<NonNullable<WireInstrument["dataIsCollectable"]>, Instrument["hasData"]>
>;
