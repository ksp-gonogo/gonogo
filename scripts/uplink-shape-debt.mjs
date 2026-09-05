/**
 * Committed docs assets with no recorded shape, per Uplink.
 *
 * An asset with a shape in `docs/assets/render-shape.json` can be checked
 * against the code that renders it: `docs --check` re-renders it and compares.
 * An asset without one cannot, and nothing anywhere can say whether its picture
 * is a picture of today's code. Zero means the whole page is verifiable.
 *
 * ## Why a debt list rather than a gate that just fails
 *
 * The shapes are RENDERED, and this repo's rule is that committed renders come
 * off Linux, because font rasterisation is OS-specific. So the records cannot be
 * seeded from a developer's machine in the commit that adds the mechanism; they
 * arrive when `uplink-docs.yml` next regenerates each page on the runner.
 *
 * Failing every asset in the interim would be a wall of red with one command
 * behind it and no way to tell a NEW break from the backlog, which is the exact
 * shape of gate this project has learned people mute. So the backlog is written
 * down and only allowed to shrink.
 *
 * ## It is a CEILING
 *
 * A count above its entry fails: a new asset, or a new Uplink, is held to what
 * is written here and cannot add unverifiable pictures. A count BELOW is reported
 * and passes, and the entry is tightened deliberately with
 * `pnpm uplink-shape-gate --update`. Same rule as `uplink-extraction-debt.mjs`
 * and `act-warning-debt.mjs`.
 *
 * An Uplink with NO entry is held to zero.
 *
 * ## Seeded 2026-08-31, cleared 2026-09-05
 *
 * The seed was 154 assets across ten Uplinks, every one of them a picture that
 * had never had a shape recorded because the mechanism did not exist. All ten
 * entries measured zero once `uplink-docs.yml` had regenerated each page, so the
 * list is empty and the gate now holds every Uplink to zero.
 *
 * The empty object is load-bearing, the same way `act-warning-debt.mjs`'s is:
 * with no entries, the first asset that arrives without a recorded shape reads
 * as new and fails.
 */

export const UNRECORDED_DEBT = {};
