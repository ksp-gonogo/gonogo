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
 * ## Seeded 2026-08-31, at the true state
 *
 * Every number here is the asset count of an Uplink that has never had a shape
 * recorded, because the mechanism did not exist. None of it is grandfathered
 * staleness being tolerated: it is the set of pictures nothing has yet been able
 * to ask a question about.
 */

export const UNRECORDED_DEBT = {
  "@ksp-gonogo/gonogo-avionics-uplink": 6,
  "@ksp-gonogo/gonogo-breaking-ground-uplink": 11,
  "@ksp-gonogo/gonogo-ferram-aerospace-research-uplink": 13,
  "@ksp-gonogo/gonogo-kerbalism-uplink": 13,
  "@ksp-gonogo/gonogo-kerbcast-uplink": 6,
  "@ksp-gonogo/gonogo-kos-uplink": 5,
  "@ksp-gonogo/gonogo-mechjeb-uplink": 5,
  "@ksp-gonogo/gonogo-principia-uplink": 22,
  "@ksp-gonogo/gonogo-real-fuels-uplink": 4,
  "@ksp-gonogo/gonogo-realantennas-uplink": 4,
  "@ksp-gonogo/gonogo-rp1-uplink": 71,
};
