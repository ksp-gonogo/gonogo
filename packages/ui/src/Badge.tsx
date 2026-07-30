/**
 * `Badge` lives in `@ksp-gonogo/ui-kit`, which is the published package and so
 * the only place an Uplink can reach it. This file is the app-side alias, the
 * same arrangement as Button / Form / Icons / Panel / Readout and the rest.
 *
 * Add nothing to it. There were two Badges for a while, byte-identical apart
 * from the doc comment, four widgets importing one and nine the other; the
 * Panel that went the same way is what it looks like once the copies have had
 * time to drift. `styleguide-duplicate-primitives.test.ts` now fails the build
 * if a name is implemented in both packages, so the split cannot come back
 * without someone being told.
 */
export {
  Badge,
  type BadgeProps,
  type BadgeSize,
  type BadgeTone,
} from "@ksp-gonogo/ui-kit";
