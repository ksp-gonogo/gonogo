// The roster×registry join, extracted so it has exactly ONE implementation
// shared by both consumers that need it:
//   - the wizard's gap classification (`../wizard/useUplinkGap.ts`), which
//     joins the mod roster against the Hub registry to produce the
//     `loaded` / `load-from-hub` / `installed-no-client` / `unavailable` /
//     `hub-unknown` badge per Uplink id (design §2.2);
//   - the runtime loader's enabled-set derivation (`./loader.ts`), which
//     needs exactly the same "is this id installed, and does a client exist
//     for it" answer to decide what to load (operator decision 2026-07-24:
//     the installed-mod roster drives the loader, not a static id list).
//
// Before this extraction the two lived as one function (`computeUplinkGap`)
// that only the wizard called; duplicating its join logic into the loader
// would have produced two parallel joins that could silently drift apart
// (e.g. one learning to treat a new roster field one way, the other not).
// One join, two thin adapters at the call sites.
//
// The two call sites see structurally different roster shapes — the
// loader's `RosterEntry` (`./loader.ts`; carries `expectedClientHash`, no
// `health`/`ownedPrefixes`) versus the wizard's `UplinkHealthEntry`
// (`@ksp-gonogo/sitrep-client`; carries `health`/`ownedPrefixes`, no
// `expectedClientHash`). Rather than force one shape to impersonate the
// other (fake `health`/`ownedPrefixes` values, or a fake `expectedClientHash`),
// this module's entry point takes the minimal `GapRosterEntry` shape the
// join actually reads (`id`/`available`/`reason`) and each caller adapts its
// own richer shape down to it.

import type { RegistryIndex, UplinkDescriptor } from "./registry";

/** The minimal roster-entry shape the join reads — every caller adapts down to this. */
export interface GapRosterEntry {
  id: string;
  available: boolean;
  reason: string | null;
}

/**
 * One Uplink's resolved gap state. The design's Results step (§3 step 6)
 * names four badge outcomes — `loaded`, `load-from-hub`, `installed-no-client`,
 * `unavailable` — all of which assume the Hub registry fetch SUCCEEDED. This
 * module adds a fifth, `hub-unknown`, for when it didn't: an installed +
 * available Uplink that isn't loaded must not be reported as
 * `installed-no-client` (a confirmed "no client published") when the truth
 * is "the Hub couldn't be checked" — design §7 states this explicitly
 * ("the wizard must not claim 'no client published' when it actually just
 * couldn't check — that would be a lie"). Collapsing those two would be
 * exactly that lie, so they're kept as distinct states.
 */
export type UplinkGapState =
  | "loaded"
  | "load-from-hub"
  | "installed-no-client"
  | "unavailable"
  | "hub-unknown";

/** design §2.2 — the cross-reference join's per-Uplink result. */
export interface UplinkGapEntry {
  id: string;
  /** From the Hub descriptor if known, else the roster id (design §2.2). */
  name: string;
  /** Present in the roster (regardless of its `available` flag). */
  installed: boolean;
  /** `roster.available` — only meaningful when `installed` is true. */
  modAvailable: boolean;
  /** `roster.reason`, surfaced verbatim, never reworded (design §3 step 6 / §7). */
  modReason: string | null;
  /** Present in the generalized loaderState — loaded via either load path. */
  loaded: boolean;
  /**
   * From the fetched registry index. `null` means "no descriptor for this
   * id in a SUCCESSFULLY fetched index" — see `state` to distinguish that
   * from a failed/not-yet-fetched index (`hub-unknown`).
   */
  hubDescriptor: UplinkDescriptor | null;
  /** The resolved state driving the wizard's row / the loader's enable decision. */
  state: UplinkGapState;
}

/**
 * Pure join (design §2.2) — no hooks, no I/O. Entries are produced for the
 * union of every roster id and every loaded id: a row must exist both for an
 * Uplink the roster reports that hasn't loaded yet, AND for one that's
 * loaded but has since dropped out of the roster (e.g. the mod unloaded
 * mid-session) — losing that second row would make an operator's already-
 * running widget vanish from the wizard's view of the world for no reason.
 * An id that appears ONLY in the registry — no roster entry, not loaded —
 * produces no row: the Results step renders one row per roster entry
 * (design §3 step 6), and registry-only "not installed anywhere" rows are
 * explicitly out of scope for v1 (same section's parenthetical). The
 * loader's enabled-set derivation reads the same shape: it filters for
 * `installed && hubDescriptor !== null`, i.e. exactly the ids this join
 * says are both live on the mod side and have a client to load.
 *
 * `rosterEntries`:
 *   - `[]` — no roster ids to join (the caller has already collapsed its
 *     tri-state "not resolved yet" / "confirmed no mod talking" / "resolved"
 *     roster down to an empty array for the first two cases).
 *
 * `hubIndex`:
 *   - `null` — the registry fetch failed, or hasn't completed yet. Every
 *     entry's `hubDescriptor` stays `null`, and any entry that would
 *     otherwise resolve `installed-no-client` resolves `hub-unknown`
 *     instead (design §7's anti-conflation rule — see `UplinkGapState`).
 *   - `RegistryIndex` — a successfully fetched index, however many (or how
 *     few — including zero) descriptors it carries.
 */
export function computeUplinkGapEntries(
  rosterEntries: readonly GapRosterEntry[],
  loadedIds: readonly string[],
  hubIndex: RegistryIndex | null,
): UplinkGapEntry[] {
  const loadedSet = new Set(loadedIds);
  const rosterById = new Map(rosterEntries.map((entry) => [entry.id, entry]));
  const hubById = new Map(
    (hubIndex?.uplinks ?? []).map((descriptor) => [descriptor.id, descriptor]),
  );

  // Set iteration preserves insertion order, so this naturally yields
  // roster order first, then any loaded-only ids in the order given.
  const ids = new Set<string>([...rosterById.keys(), ...loadedSet]);

  const entries: UplinkGapEntry[] = [];
  for (const id of ids) {
    const rosterEntry = rosterById.get(id);
    const hubDescriptor = hubById.get(id) ?? null;
    const loaded = loadedSet.has(id);
    const installed = rosterEntry !== undefined;
    const modAvailable = rosterEntry?.available ?? false;
    const modReason = rosterEntry?.reason ?? null;
    const name = hubDescriptor?.name ?? id;

    let state: UplinkGapState;
    if (loaded) {
      state = "loaded";
    } else if (!modAvailable) {
      // `ids` only ever contains roster keys and loaded ids; reaching this
      // branch with `loaded === false` means this id came from
      // `rosterById`, so `installed` is guaranteed true here — this is the
      // mod's own "unavailable" report, not an absent entry.
      state = "unavailable";
    } else if (hubIndex === null) {
      state = "hub-unknown";
    } else if (hubDescriptor) {
      state = "load-from-hub";
    } else {
      state = "installed-no-client";
    }

    entries.push({
      id,
      name,
      installed,
      modAvailable,
      modReason,
      loaded,
      hubDescriptor,
      state,
    });
  }

  return entries;
}
