// Hub-wizard gap computation (design §2.2 / §3 step 5): the pure join that
// cross-references the live mod roster (`system.uplinkHealth`), the loaded-
// outcome set (`loaderState.ts`, generalized across both load paths per
// design decision 3), and the Hub registry index into one resolved state per
// Uplink id. `computeUplinkGap` is the pure core (no hooks, no I/O);
// `useUplinkGap` gathers the three live inputs and re-derives on change.

import type { SystemUplinkHealth } from "@ksp-gonogo/sitrep-client";
import { useStream } from "@ksp-gonogo/sitrep-client";
import { useQuery } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import {
  getUplinkOutcomes,
  subscribeUplinkOutcomes,
} from "../uplinks/loaderState";
import {
  fetchRegistry,
  hubRegistrySource,
  type RegistryIndex,
  type UplinkDescriptor,
} from "../uplinks/registry";

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
  /** Present in `system.uplinks` (regardless of its `available` flag). */
  installed: boolean;
  /** `roster.available` — only meaningful when `installed` is true. */
  modAvailable: boolean;
  /** `roster.reason`, surfaced verbatim, never reworded (design §3 step 6 / §7). */
  modReason: string | null;
  /** Present in the generalized loaderState — loaded via either load path. */
  loaded: boolean;
  /**
   * From `fetchRegistry(hubRegistrySource())`. `null` means "no descriptor
   * for this id in a SUCCESSFULLY fetched index" — see `state` to
   * distinguish that from a failed/not-yet-fetched index (`hub-unknown`).
   */
  hubDescriptor: UplinkDescriptor | null;
  /** The resolved state driving the wizard's row. See `UplinkGapState`. */
  state: UplinkGapState;
}

/**
 * Pure join (design §2.2) — no hooks, no I/O. Entries are produced for the
 * union of every roster id and every loaded id: a row must exist both for an
 * Uplink the roster reports that hasn't loaded yet, AND for one that's
 * loaded but has since dropped out of the roster (e.g. the mod unloaded
 * mid-session) — losing that second row would make an operator's already-
 * running widget vanish from the wizard's view of the world for no reason.
 * An id that appears ONLY in the Hub manifest — no roster entry, not loaded —
 * produces no row: the Results step renders one row per roster entry
 * (design §3 step 6), and hub-only "not installed anywhere" rows are
 * explicitly out of scope for v1 (same section's parenthetical).
 *
 * `roster`:
 *   - `undefined` — `system.uplinkHealth` hasn't resolved yet (still
 *     waiting on the mod). NOT an error: contributes zero roster ids to the
 *     join, same as `null` — the two are indistinguishable at this pure
 *     layer; only `useUplinkGap`'s `loading` flag tells them apart.
 *   - `null` — a confirmed tombstone ("no mod talking"). Also contributes
 *     zero roster ids.
 *   - `SystemUplinkHealth` — the decoded roster array.
 *
 * `hubIndex`:
 *   - `null` — the Hub registry fetch failed, or hasn't completed yet.
 *     Every entry's `hubDescriptor` stays `null`, and any entry that would
 *     otherwise resolve `installed-no-client` resolves `hub-unknown`
 *     instead (design §7's anti-conflation rule — see `UplinkGapState`).
 *   - `RegistryIndex` — a successfully fetched index, however many (or how
 *     few — including zero) descriptors it carries.
 */
export function computeUplinkGap(
  roster: SystemUplinkHealth | null | undefined,
  loadedIds: readonly string[],
  hubIndex: RegistryIndex | null,
): UplinkGapEntry[] {
  const loadedSet = new Set(loadedIds);
  const rosterEntries = roster?.uplinks ?? [];
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

const HUB_REGISTRY_QUERY_KEY = ["uplink-hub", "registry"] as const;

export interface UseUplinkGapResult {
  entries: UplinkGapEntry[];
  loading: boolean;
  error: string | null;
}

/**
 * React-hook wrapper (design §2.2). Gathers the three live inputs
 * `computeUplinkGap` joins and re-derives on every change:
 *   - the mod roster, via the same `useStream<SystemUplinkHealth>(...)` call
 *     `SettingsModal.tsx`'s `UplinkHealthList` already proves works
 *     post-render;
 *   - the loaded-outcome ids, via `getUplinkOutcomes()` +
 *     `subscribeUplinkOutcomes` through `useSyncExternalStore` — the same
 *     pattern `SettingsModal.tsx`'s `UplinkLoaderSection` already uses;
 *   - the Hub registry index, fetched via `fetchRegistry(hubRegistrySource())`
 *     through `@tanstack/react-query`'s `useQuery` — the app's existing
 *     async data-fetch primitive (`QueryClientProvider` is already mounted
 *     at `main.tsx`'s root; nothing else in the app has used `useQuery` yet,
 *     so this is the first call site, not a new dependency).
 *
 * `loading` is true while the roster is still `undefined` (design §3 step 4:
 * "waits for a defined value") OR the registry query hasn't settled yet.
 * `error` surfaces the registry query's failure message verbatim (design
 * §7's "Hub unavailable" case) — a `null` roster ("no mod talking") is NOT
 * an error and never populates `error`.
 */
export function useUplinkGap(): UseUplinkGapResult {
  const roster = useStream<SystemUplinkHealth>("system.uplinkHealth");
  const outcomes = useSyncExternalStore(
    subscribeUplinkOutcomes,
    getUplinkOutcomes,
  );
  const loadedIds = outcomes
    .filter((outcome) => outcome.status === "loaded")
    .map((outcome) => outcome.id);

  const registryQuery = useQuery({
    queryKey: HUB_REGISTRY_QUERY_KEY,
    queryFn: () => fetchRegistry(hubRegistrySource()),
    retry: false,
  });

  const hubIndex = registryQuery.data ?? null;
  const entries = computeUplinkGap(roster, loadedIds, hubIndex);

  return {
    entries,
    loading: roster === undefined || registryQuery.isPending,
    error: registryQuery.isError
      ? registryQuery.error instanceof Error
        ? registryQuery.error.message
        : String(registryQuery.error)
      : null,
  };
}
