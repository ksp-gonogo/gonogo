import type { VesselTarget } from "../__generated__/contract";
import type { ReckonerDefinition } from "../reading";
import { registerReckoner } from "./reckoners";

/**
 * What `registerReckoner`'s signature is FOR, asserted rather than believed.
 *
 * Its first parameter was a bare `string`, which cost twice over and silently:
 * a topic with a typo registered a model nothing would ever elect, and the
 * payload type could not be inferred from the topic, so every author annotated
 * it by hand against nothing. Both failures are invisible in a passing suite,
 * because neither produces a wrong number: they produce a value that is simply
 * never reckoned.
 *
 * Runs only under `pnpm typecheck`, the sole pass that compiles `*.test-d.ts`
 * (vitest goes through esbuild and never typechecks). Every `@ts-expect-error`
 * here is two-sided the way `reading.test-d.ts` describes: it fails if the line
 * starts compiling, because the directive is then unused.
 */

declare const targetModel: ReckonerDefinition<
  VesselTarget,
  VesselTarget,
  readonly []
>;

// @ts-expect-error `vessel.taget` is not a Topic, and a typo is now a compile error.
registerReckoner("vessel.taget", "core", targetModel);

/*
 * The same definition on the correctly spelled topic. This is the other half of
 * the assertion above: without it, a directive that started firing for some
 * unrelated reason would read as the guarantee holding.
 */
registerReckoner("vessel.target", "core", targetModel);

/*
 * The payload type comes off the topic. Nothing here names `VesselTarget`, and
 * a field that is not on it does not compile.
 */
registerReckoner("vessel.target", "core", {
  deps: [],
  reckon(point) {
    const observed = point.payload?.relativePosition;
    // @ts-expect-error `relativePostion` is not a field of this topic's payload.
    const typo = point.payload?.relativePostion;
    return {
      declined: {
        reason: "model-inapplicable",
        note: `${observed === undefined} ${typo === undefined}`,
      },
    };
  },
});

/*
 * A dep that opted into a window resolves to an ARRAY, and one that did not
 * resolves to a single point, in the same destructuring and with no cast on
 * either. `frame.history` is the reckoner's OWN topic over its own window.
 */
registerReckoner("vessel.flight", "core", {
  deps: ["vessel.orbit", "system.bodies"],
  window: { spanUt: 300, maxSamples: 32, minSamples: 2 },
  depWindows: { "vessel.orbit": { spanUt: 120, maxSamples: 8 } },
  reckon(_point, [orbitHistory, bodies], frame) {
    const oldestOrbitUt: number | undefined = orbitHistory[0]?.validAt;
    const bodiesUt: number | undefined = bodies?.validAt;
    const oldestOwnUt: number | undefined = frame.history[0]?.validAt;
    const ownAltitude = frame.history[0]?.payload?.altitudeAsl;
    // @ts-expect-error a windowed dep is an array of points, never one point.
    const notAPoint = orbitHistory.validAt;
    // @ts-expect-error a dep with no window is one point, never an array.
    const notAnArray = bodies?.length;
    return {
      declined: {
        reason: "insufficient-history",
        note: `${oldestOrbitUt} ${bodiesUt} ${oldestOwnUt} ${ownAltitude} ${notAPoint} ${notAnArray}`,
      },
    };
  },
});

/*
 * `minSamples` is the own topic's sufficiency floor and a dep has no such
 * thing, which is why `DepWindow` is a separate type rather than
 * `ReckonerWindow` with a comment saying not to use one field.
 */
registerReckoner("vessel.flight", "core", {
  deps: ["vessel.orbit"],
  depWindows: {
    "vessel.orbit": {
      spanUt: 120,
      maxSamples: 8,
      // @ts-expect-error a floor on a dep would refuse every slow-moving input.
      minSamples: 3,
    },
  },
  reckon() {
    return { declined: { reason: "model-inapplicable" } };
  },
});

/*
 * And a window can only be declared for a dep this reckoner actually has. The
 * key type is the declared deps, not an open string, so the same class of typo
 * the topic parameter used to allow cannot come back one level down.
 */
registerReckoner("vessel.flight", "core", {
  deps: ["vessel.orbit"],
  // @ts-expect-error `system.bodies` is not one of this reckoner's declared deps.
  depWindows: { "system.bodies": { spanUt: 60, maxSamples: 4 } },
  reckon() {
    return { declined: { reason: "model-inapplicable" } };
  },
});
