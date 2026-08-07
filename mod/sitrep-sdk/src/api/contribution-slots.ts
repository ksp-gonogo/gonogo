// ---------------------------------------------------------------------------
// Contribution-registry mirror: the `ContributionRegistry` declaration-merge
// for every first-party (packages/components-owned) contribution slot,
// carried by the sdk leaf itself. Same reasoning, same file-identity caveat,
// same "components-owned only, Uplink-owned slots stay in the Uplink's own
// file" scope split as `slots.ts` (see that file's header for the long
// form).
//
// Merges into the `ContributionRegistry {}` base declared in `./types.ts`,
// exactly like `slots.ts` merges into that file's `SlotRegistry {}` base: TS
// module augmentation with a relative specifier only attaches to an EXISTING
// export of the target module (an augmentation of a name types.ts hasn't
// declared is instead treated as a brand new ambient module declaration,
// which TS rejects outright for a relative path), so the base interface has
// to live in types.ts itself even while it stays empty.
//
// The `export {}` below is load-bearing, not decorative: it is what makes
// this FILE a module in TS's eyes. `slots.ts` gets that status for free from
// its own top-level `export interface` declarations (its real slot context
// types); this scaffold has no such content yet, so without an explicit
// export TS would treat it as a global script and reject the relative
// `declare module` specifier below with "Ambient module declaration cannot
// specify relative module name". Drop this line once the first real
// contribution slot's context type gives the file a natural export.
//
// Empty today: no first-party contribution slot exists yet (Application
// phase, contribution-slots-spec §14, is a separate follow-up plan). This
// file is the scaffold the first one (e.g. "ship-map.part-meta") fills in.
// ---------------------------------------------------------------------------

export {};

declare module "./types" {
  // Empty merge, no biome suppression needed here: unlike the base
  // declaration in types.ts, biome's noEmptyInterface rule doesn't fire
  // inside a declare-module augmentation block.
  interface ContributionRegistry {}
}
