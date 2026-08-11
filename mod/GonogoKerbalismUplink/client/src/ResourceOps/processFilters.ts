import type {
  ContributionEntry,
  IsruConverterEntry,
} from "@ksp-gonogo/sitrep-sdk";
import { readKerbalismIsruConverterExt } from "../isru";
import { KERBALISM } from "../uplink";

// ---------------------------------------------------------------------------
// Kerbalism's own axis on ResourceOps' filter slot: one facet per PROCESS
// running on the vessel, plus its broken state.
//
// ── Why this is the honest answer, and what it deliberately is not ──────────
// Kerbalism does not distinguish an ISRU process from a life-support one: a
// scrubber, a water recycler and a Molten Regolith Electrolysis plant are the
// same `ProcessController` running different chemistry (see `../isru.ts`'s
// header). So `isru.converters` carries all of them, the list is long, and the
// obvious-looking fix, a "life support" toggle, would be gonogo asserting a
// taxonomy the engine does not draw.
//
// What Kerbalism CAN say is which process each row IS, because that is a thing
// it genuinely models: `processToken` is the ProcessController pseudo-resource
// that identifies the process in the loaded profile, and `title` is the name
// the profile's own author gave it. Every label below is therefore Kerbalism's
// word, not ours, and the axis is more useful than the generic by-resource one
// precisely because it is the provider's.
//
// Not contributed, on purpose: a facet built on the profile's `isSupply` flag.
// The flag is real, but a filter standing on it would read as the life-support
// split while not being it, since an MRE plant produces Oxygen (a declared
// supply) and would land on the "life support" side of a line it has no
// business being near. Naming a filter after a real field is not enough; the
// filter has to MEAN what its label implies. Per-process is honest all the way
// down.
//
// Gated `requires: "kerbalism"`, so on any other install these facets simply
// never appear and the widget shows the built-in by-resource axis alone.
// ---------------------------------------------------------------------------

type ResourceOpsFilter = ContributionEntry<"resource-ops.filters">;
/** The widget's row union, read back off the slot's own entry type rather than
 *  imported: a facade-sealed client names a host's shapes through the merge,
 *  never through the host's package. */
type ResourceOpsUnit = Parameters<ResourceOpsFilter["predicate"]>[0];

const PROCESS_GROUP = "kerbalism-process";
const BROKEN_ID = "broken";

function converterOf(unit: ResourceOpsUnit): IsruConverterEntry | null {
  // A drill is not a Kerbalism process, so every facet here rejects one. That
  // is the intended reading: asking for "the Scrubber" is not asking to also
  // see the vessel's Ore drill.
  return unit.kind === "converter" ? unit.converter : null;
}

interface ProcessFacet {
  token: string;
  title: string;
}

/** Distinct processes present, in first-seen order, labelled with Kerbalism's own title. */
function processFacets(
  converters: readonly IsruConverterEntry[],
): ProcessFacet[] {
  const seen = new Map<string, ProcessFacet>();
  for (const converter of converters) {
    const ext = readKerbalismIsruConverterExt(converter);
    const token = ext?.processToken;
    if (!token || seen.has(token)) continue;
    // The profile does not always carry a title; the token is Kerbalism's own
    // identifier either way, so it stands in rather than inventing a name.
    seen.set(token, { token, title: ext?.title || token });
  }
  return [...seen.values()];
}

function anyBroken(converters: readonly IsruConverterEntry[]): boolean {
  return converters.some(
    (converter) => readKerbalismIsruConverterExt(converter)?.broken === true,
  );
}

/**
 * Pure core, exported for tests (the `computeKerbalismPartMeters` pattern).
 *
 * Memoised on the facet set so a live rate update does not hand the aggregator
 * a fresh array of predicates every frame; only a genuine change in which
 * processes are aboard rebuilds it.
 */
let cachedKey: string | null = null;
let cachedEntries: readonly ResourceOpsFilter[] = [];

export function computeKerbalismProcessFilters(
  converters: readonly IsruConverterEntry[] | undefined,
): readonly ResourceOpsFilter[] {
  const list = converters ?? [];
  const facets = processFacets(list);
  const broken = anyBroken(list);

  // One process aboard means the facet can only repeat what the list already
  // shows, so it earns no control of its own.
  const showProcesses = facets.length > 1;
  const key = `${showProcesses ? facets.map((f) => f.token).join(" ") : ""}|${broken}`;
  if (key === cachedKey) return cachedEntries;

  const entries: ResourceOpsFilter[] = [];
  if (showProcesses) {
    for (const facet of facets) {
      entries.push({
        id: facet.token,
        label: facet.title,
        group: PROCESS_GROUP,
        groupLabel: "Process",
        // Independent facets of one axis: showing the scrubber AND the water
        // recycler together is a normal thing to want.
        selection: "multi",
        predicate: (unit) => {
          const converter = converterOf(unit);
          return (
            converter !== null &&
            readKerbalismIsruConverterExt(converter)?.processToken ===
              facet.token
          );
        },
      });
    }
  }

  // Its own standalone axis, and only while something is actually broken: a
  // toggle that can never match anything is worse than no toggle.
  if (broken) {
    entries.push({
      id: BROKEN_ID,
      label: "Broken",
      predicate: (unit) => {
        const converter = converterOf(unit);
        return (
          converter !== null &&
          readKerbalismIsruConverterExt(converter)?.broken === true
        );
      },
    });
  }

  cachedKey = key;
  cachedEntries = entries;
  return cachedEntries;
}

/** Test-only: drops the memo so one test's vessel cannot leak into the next. */
export function resetProcessFilterCache(): void {
  cachedKey = null;
  cachedEntries = [];
}

KERBALISM.registerContribution({
  id: "resource-ops-processes",
  contributes: "resource-ops.filters",
  deps: ["isru.converters"],
  requires: "kerbalism",
  compute: (topics) =>
    computeKerbalismProcessFilters(
      topics["isru.converters"] as IsruConverterEntry[] | undefined,
    ),
});
