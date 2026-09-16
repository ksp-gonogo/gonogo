/**
 * The planted violation `primitive-reading-feed.test.ts` drives its gate with,
 * written against the REAL types rather than a lookalike.
 *
 * Outside `packages/components/tsconfig.json`'s `include` (`src` and
 * `scripts/**\/*.test.ts`), so the real walk never sees it and the gate's
 * zero is not this file's. The blindness check compiles it on its own, with
 * that tsconfig's options, so `@ksp-gonogo/ui-kit` and the sdk resolve exactly
 * as they do for a widget.
 *
 * It lives beside `components` rather than beside the gate in `core` because
 * pnpm links a workspace dependency into the dependent's own `node_modules`:
 * `core` does not depend on `ui-kit`, so a fixture there could not import the
 * primitive whose prop type is half of what this proves.
 *
 * WHY IT IS NOT ENOUGH TO PLANT INTO A SYNTHETIC WORLD. The rule keys on a
 * type having both currency members, and on a JSX prop's contextual type
 * having a reading-shaped arm. A hand-written `interface Reading` satisfies
 * both by construction, so a synthetic plant proves the predicate agrees with
 * itself. What it cannot tell you is whether the SDK's `Reading` still looks
 * like that after passing through the field-property projection, or whether
 * `Unit`'s widened prop still offers the arm. Those are the two things that
 * would quietly stop being true, and they are what this file compiles.
 */

import { useTelemetry } from "@ksp-gonogo/core";
import { observedAt, type Value, value } from "@ksp-gonogo/sitrep-sdk";
import { Unit } from "@ksp-gonogo/ui-kit";

export function PlantedUnwrap() {
  const flight = useTelemetry("vessel.flight");
  const altitude = flight.altitudeAsl;
  const named = altitude.value;
  return (
    <>
      {/* PLANT: the unwrap written inline */}
      <Unit value={altitude.value} />
      {/* PLANT: the same unwrap, named first */}
      <Unit value={named} />
      {/* CONTROL: the reading passed whole, which is the point of the rule */}
      <Unit value={altitude} />
    </>
  );
}

/**
 * The two shapes the guard must learn, and which NEITHER existing gate sees.
 *
 * `styleguide-primitive-inputs`'s gate B is textual: it refuses arithmetic, a
 * bare magnitude or a cast written IN the prop, and both of these are written
 * somewhere else. `primitive-reading-feed` keys on a property literally named
 * `value` on a reading-shaped object, and neither of these is that: the first
 * divides two payload numbers, the second takes a magnitude two calls deep.
 *
 * Both are the same fault the file's header describes, one hop further back:
 * a figure derived from a reading, handed over with the currency stripped off.
 */
export function PlantedIndirectUnwrap() {
  const flight = useTelemetry("vessel.flight");
  const payload = flight.value;

  // PLANT: arithmetic over reading-derived numbers, named on a previous line.
  const share = (payload?.altitudeAsl?.magnitude ?? 0) / 70_000;

  // PLANT: an unwrap laundered through a helper, so the prop holds a call.
  const asRatio = ratioOf(payload?.altitudeAsl);

  return (
    <>
      <Unit value={value("ratio", share)} />
      <Unit value={asRatio} />
    </>
  );
}

/** Stands in for `fill(magnitudeOf(x))`: a magnitude, two calls deep. */
function ratioOf(q: { magnitude: number } | undefined): Value<"ratio"> {
  return value("ratio", (q?.magnitude ?? 0) / 70_000);
}

/**
 * The exemptions, and the controls that keep each one honest.
 *
 * A figure taken off a reading's CURRENCY or its MODEL is not the accidental
 * discard this gate looks for: the rule at the top of the scan has always said
 * so, and `unwrapOf` has always honoured it. The walk did not, so the exemption
 * survived `reading.reckoning.x` and evaporated for `f(reading.reckoning.x)`.
 *
 * The age is the case that makes it a correctness matter rather than a tidiness
 * one. `viewUt.minus(observedAt(reading))` is recomputed against the current
 * frame on every render, so it is exactly current when it is drawn, and its
 * whole job is to say that something ELSE is old. Forced to carry its reading
 * it would draw itself not-current, which is the one figure on the panel that
 * certainly is not.
 *
 * Each exemption is planted beside the real fault one hop away, because an
 * exemption that also swallows the fault is worse than no exemption.
 */
export function PlantedCurrencyExemptions() {
  const flight = useTelemetry("vessel.flight");
  const altitude = flight.altitudeAsl;
  const viewUt = value("ut", 1000);
  const observedUt = observedAt(altitude) ?? viewUt;

  /*
   * EXEMPT: an age, off the instant the observation was made. Written in the
   * algebra the sdk's own `observedAt` doc prescribes (an instant minus an
   * instant IS a duration), so no magnitude is unwrapped to build it and the
   * provenance runs entirely through the accessor.
   */
  const ageSec = viewUt.minus(observedUt);

  // EXEMPT: the same instant reached as a member rather than through the accessor.
  const stampSec = viewUt.minus(altitude.atUt ?? viewUt);

  // EXEMPT: the MODEL's figure, one hop away from `reading.reckoning`.
  const modelled =
    altitude.reckoning.status === "available"
      ? altitude.reckoning.modelled
      : undefined;

  // PLANT: the value itself, derived one hop away. The exemptions above sit on
  // the SAME reading, so one that over-reached would swallow this.
  const doubled = altitude.value?.times(2);

  return (
    <>
      <Unit value={ageSec} />
      <Unit value={stampSec} />
      <Unit value={modelled ?? null} />
      <Unit value={doubled ?? null} />
    </>
  );
}

/**
 * The name-versus-declaration control, in its own scope so it can SHADOW the
 * import rather than approximate it.
 *
 * A local `observedAt` that hands back the value is the whole reason membership
 * is the declaring module: a gate keyed on the spelling would exempt this and
 * report a clean tree over a live unwrap. `styleguide-reading-shape` learned the
 * same lesson resolving an imported narrower by its declaration.
 */
export function PlantedBorrowedAccessorName() {
  const flight = useTelemetry("vessel.flight");
  const altitude = flight.altitudeAsl;

  function observedAt<T>(reading: { value?: T }): T | undefined {
    return reading.value;
  }

  // PLANT: same spelling as the sdk's accessor, different declaration, and it
  // launders the VALUE.
  return <Unit value={observedAt(altitude) ?? null} />;
}
