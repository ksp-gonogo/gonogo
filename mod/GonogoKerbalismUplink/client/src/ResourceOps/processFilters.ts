import type { IsruConverterEntry } from "@ksp-gonogo/sitrep-sdk";
import { readKerbalismIsruConverterExt } from "../isru";
import { KERBALISM } from "../uplink";

// ---------------------------------------------------------------------------
// Kerbalism's own axis on ResourceOps' filter slot: one pre-filled SEARCH TERM
// per PROCESS running on the vessel, labelled with Kerbalism's own process title.
//
// Why this is the honest answer, and what it deliberately is not.
//
// Kerbalism does not distinguish an ISRU process from a life-support one: a
// scrubber, a water recycler and a Molten Regolith Electrolysis plant are the
// same `ProcessController` running different chemistry (see `../isru.ts`'s
// header). So `isru.converters` carries all of them, the list is long, and the
// obvious-looking fix, a "life support" toggle, would be gonogo asserting a
// taxonomy the engine does not draw.
//
// What Kerbalism CAN say is which process each row IS, because that is a thing
// it genuinely models: `title` is the name the loaded profile's own author gave
// the process. Every term below is therefore Kerbalism's word, not ours. The
// term filters against the widget's `searchText` as a plain substring, and the
// process title is itself a substring of the shared `partTitle` ("Scrubber" in
// "CO2 Scrubber"), so a term chip narrows the list to that process without the
// widget ever reading this Uplink's extension bag.
//
// Not contributed, on purpose: a term built on the profile's `isSupply` flag.
// The flag is real, but a filter standing on it would read as the life-support
// split while not being it, since an MRE plant produces Oxygen (a declared
// supply) and would land on the "life support" side of a line it has no
// business being near. Naming a filter after a real field is not enough; the
// filter has to MEAN what its label implies. Per-process is honest all the way
// down.
//
// Gated `requires: "kerbalism"`, so on any other install these terms simply
// never appear and the widget shows the plain search box alone.
// ---------------------------------------------------------------------------

/**
 * Distinct process titles present on the vessel, in first-seen order. Pure,
 * exported for tests the same way `computeKerbalismPartMeters` is.
 */
export function computeKerbalismProcessTerms(
  converters: readonly IsruConverterEntry[] | undefined,
): string[] {
  const titles = new Set<string>();
  for (const converter of converters ?? []) {
    const title = readKerbalismIsruConverterExt(converter)?.title?.trim();
    // No title means the profile did not name this process; there is nothing
    // honest to label a term with, so it contributes none.
    if (title) titles.add(title);
  }
  return [...titles];
}

KERBALISM.registerContribution({
  id: "resource-ops-processes",
  contributes: "resource-ops.filters",
  deps: ["isru.converters"],
  requires: "kerbalism",
  compute: (topics) => computeKerbalismProcessTerms(topics["isru.converters"]),
});
