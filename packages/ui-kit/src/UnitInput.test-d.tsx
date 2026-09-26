import { value } from "@ksp-gonogo/sitrep-sdk";
import { UnitInput } from "./UnitInput";

/**
 * The rules `UnitInput` keeps in the type system. They live here because the
 * package's `tsc` excludes `*.test.tsx`, where a `@ts-expect-error` would never
 * be compiled. Each unused directive fails `pnpm typecheck`.
 */

// A point-like unit refuses a slider.
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

// An interval of the same dimension takes one: the rule is about point-ness, not time.
export const intervalTakesARange = (
  <UnitInput
    label="Coast"
    unit="s"
    value={value("s", 60)}
    onChange={() => {}}
    range={{ min: 0, max: 600 }}
  />
);

// The value and the emitted value carry the same unit.
export const unitsMustAgree = (
  <UnitInput
    label="Tangent"
    unit="m/s"
    // @ts-expect-error a length is not a speed
    value={value("m", 12)}
    onChange={() => {}}
  />
);
