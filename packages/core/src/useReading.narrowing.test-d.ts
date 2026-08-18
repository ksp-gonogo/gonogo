import type { NeverReckonable } from "@ksp-gonogo/sitrep-client";
import { useReading } from "./hooks/useReading";

/**
 * The `reckonable` arm is gone where it can never occur, checked by `tsc`.
 *
 * Compiled by `tsconfig.test-d.json`, `@ts-expect-error` included, so the day
 * the narrowing stops biting this file fails the build rather than quietly
 * becoming documentation. That matters more than usual here: a narrowing that
 * silently widened would put back a branch every migrated widget had been told
 * it did not need to write, and nothing else would notice.
 */

// `vessel.control` is command echo: a commanded state is not a forward model,
// and it lives on the expectation channel instead.
declare const controlIsDeclared: "vessel.control" extends NeverReckonable
  ? true
  : false;
const _controlIsDeclared: true = controlIsDeclared;
void _controlIsDeclared;

function useNeverReckonableProbe() {
  const control = useReading("vessel.control");
  // `stale` remains, and remains the widget's job: the narrowing removes an
  // impossible case, never the judgement.
  if (control.state === "stale") {
    void control.value;
    void control.asOfUt;
  }
  // @ts-expect-error `vessel.control` can never carry a model, so there is no such arm
  if (control.state === "reckonable") {
    /* unreachable by construction */
  }
}

function useModellableProbe() {
  // `vessel.orbit` is the flagship propagatable topic, so the arm must be there
  // and `reckon()` must resolve through it.
  const orbit = useReading("vessel.orbit");
  if (orbit.state === "reckonable") {
    void orbit.reckon().basis;
    void orbit.reckon().value.sma;
  }
}

void useNeverReckonableProbe;
void useModellableProbe;
