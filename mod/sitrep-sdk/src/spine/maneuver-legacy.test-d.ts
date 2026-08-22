// Type-level test for the maneuver wire payload's optional fields.
//
// Enforced by `tsc` via `tsconfig.test-d.json`, same as `units.test-d.ts` and
// for the same reason. Runtime behaviour lives in `maneuver-legacy.test.ts`.
//
// `mapManeuverNode` tolerates an absent `patches` at runtime (`?? []`), and
// that tolerance is load-bearing rather than defensive: a stored recording
// predating the field replays into the same mapper the live stream uses. A
// required `patches` would state a guarantee that data does not honour, and
// nothing else would catch the disagreement, because a type is erased before
// the mapper ever runs.
//
// `frame`, `ignitionUt` and `cutoffUt` are optional for the same reason and
// are pinned alongside it, so the whole set moves together or fails here.

import { value } from "../unit-system/value";
import type { ManeuverNodeWirePayload } from "./maneuver-legacy";

// A node off a recording that predates the later fields still describes the
// wire.
export const _preFieldRecordingNode: ManeuverNodeWirePayload = {
  id: "node-1",
  ut: value("s", 1200),
};

// @ts-expect-error: `id` and `ut` are the two a node cannot be read without
export const _rejectsNodeWithoutUt: ManeuverNodeWirePayload = { id: "node-1" };
