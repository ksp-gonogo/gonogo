/**
 * A duration and an instant are different things, and `tsc` now knows it.
 *
 * Compiled by `tsconfig.test-d.json`, `@ts-expect-error` blocks included, so a
 * narrowing that stopped biting fails the build rather than quietly becoming
 * documentation.
 *
 * The bug this pins shipped: `OrbitEncounter.transitionUt` is an absolute UT
 * and reached `<Countdown>` through `vessel.state` in two widgets, rendering a
 * Mun encounter twenty minutes away as "46d 2h". A third widget reading the
 * same field subtracted the view time correctly. Nothing could tell the two
 * call sites apart, because `Units.Seconds` was the token on a duration and on
 * an instant alike.
 */

import { value } from "@ksp-gonogo/sitrep-sdk";
import { Countdown } from "./Countdown";
import { MissionDate } from "./MissionDate";

const timeToApoapsis = value("s", 8_040);
const encounterUt = value("ut", 1_001_200);
const viewUt = 1_000_000;

// ── A duration counts down, an instant does not ─────────────────────────────
<Countdown value={timeToApoapsis} />;

// @ts-expect-error an instant is not a duration; subtract the frame's view time first
<Countdown value={encounterUt} />;

// Which is what that subtraction looks like. `.magnitude` because UT
// arithmetic is on plain numbers at the unwrap boundary.
<Countdown value={encounterUt.magnitude - viewUt} />;

// ── An instant renders as a date ────────────────────────────────────────────
<MissionDate value={encounterUt} />;

// The client's own view time has no declared unit to carry, so a bare number
// stays valid: it is how every client-computed clock reaches here.
<MissionDate value={viewUt} />;
