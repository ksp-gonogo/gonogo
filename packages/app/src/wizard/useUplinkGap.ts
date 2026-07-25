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
} from "../uplinks/registry";
import {
  computeUplinkGapEntries,
  type UplinkGapEntry,
  type UplinkGapState,
} from "../uplinks/rosterGap";

// Re-exported so existing consumers (`ResultsStep.tsx` et al.) keep importing
// these types from this module — the join itself now lives in
// `../uplinks/rosterGap.ts`, shared with the loader's enabled-set derivation
// (`../uplinks/loader.ts`). See that module's header for why it was
// extracted rather than called directly with a fabricated `SystemUplinkHealth`.
export type { UplinkGapEntry, UplinkGapState };

/**
 * Pure join (design §2.2) — thin adapter over the shared
 * `computeUplinkGapEntries` join (`../uplinks/rosterGap.ts`), which the
 * loader's enabled-set derivation also calls. This wrapper's only job is
 * unwrapping the wizard's `SystemUplinkHealth` shape down to the join's
 * minimal `GapRosterEntry[]` input — see `rosterGap.ts`'s header for why
 * that adaptation lives at each call site instead of forcing one shape to
 * impersonate the other.
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
  return computeUplinkGapEntries(roster?.uplinks ?? [], loadedIds, hubIndex);
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
