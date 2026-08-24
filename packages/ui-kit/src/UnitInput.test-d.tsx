import { value } from "@ksp-gonogo/sitrep-sdk";
import { UnitInput } from "./UnitInput";

/**
 * The rules `UnitInput` keeps in the TYPE system rather than at runtime.
 *
 * <p>Here rather than beside the runtime tests because the package's own `tsc`
 * excludes `*.test.tsx`: a `@ts-expect-error` written there is never compiled,
 * so it asserts nothing while looking exactly like it does. That is not
 * hypothetical, it is where this file's contents started.</p>
 */

// A point-like unit refuses a slider. A UT is legitimately years out, so no
// pair of bounds is the right pair.
//
// The directive IS the assertion: should this stop being a type error, the
// unused `@ts-expect-error` becomes one and `pnpm typecheck` fails, so the rule
// cannot quietly lapse.
export const instantRefusesARange = (
  <UnitInput
    label="Ignition"
    unit="ut"
    value={value("ut", 1000)}
    onChange={() => {}}
    // @ts-expect-error a point-like unit has no slidable range
    range={{ min: 0, max: 10_000 }}
  />
);

// An INTERVAL of the same dimension takes one, which is what makes the rule
// about point-ness rather than about time.
export const intervalTakesARange = (
  <UnitInput
    label="Coast"
    unit="s"
    value={value("s", 60)}
    onChange={() => {}}
    range={{ min: 0, max: 600 }}
  />
);

// The value and the emitted value carry the SAME unit: a control for one
// dimension cannot be handed another's value.
export const unitsMustAgree = (
  <UnitInput
    label="Tangent"
    unit="m/s"
    // @ts-expect-error a length is not a speed
    value={value("m", 12)}
    onChange={() => {}}
  />
);
