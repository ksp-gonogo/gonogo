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
