/**
 * A duration and an instant are different types: `<Countdown>` refuses an
 * absolute UT until the view time is subtracted.
 *
 * Compiled by `tsconfig.test-d.json`, `@ts-expect-error` blocks included, so a
 * narrowing that stopped biting fails the build.
 */

import { value } from "@ksp-gonogo/sitrep-sdk";
import { Countdown } from "./Countdown";
import { MissionDate } from "./MissionDate";

const timeToApoapsis = value("s", 8_040);
const encounterUt = value("ut", 1_001_200);
const viewUt = 1_000_000;

<Countdown value={timeToApoapsis} />;

// @ts-expect-error an instant is not a duration; subtract the frame's view time first
<Countdown value={encounterUt} />;

// UT arithmetic is on plain numbers at the unwrap boundary.
<Countdown value={encounterUt.magnitude - viewUt} />;

<MissionDate value={encounterUt} />;

// A client-computed clock has no declared unit to carry, so a bare number stays valid.
<MissionDate value={viewUt} />;
