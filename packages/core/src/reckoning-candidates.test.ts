// @vitest-environment node
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Dimension, lookupUnit } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import VERDICTS from "./reckoning-candidates.json";

/**
 * Rate-integration candidates: every quantity on the wire that sits beside a
 * sibling in compatible per-second units, each carrying a human verdict.
 *
 * ## Why this is a ratchet and never a default
 *
 * The appealing idea is that a reckoning class DERIVES: a quantity with a
 * companion rate is rate-integrable, so nobody has to declare anything. Run
 * over the real contract it does not survive contact. Of the candidates below,
 * most carry TWO OR MORE sibling rates, so the rule cannot even pick which one
 * to integrate; and among those it can, almost none is the actual derivative.
 * The rule proposes integrating a tank's CAPACITY because a flow sits beside
 * it, an accident report's peak altitude because a peak speed does, and a
 * terrain-sampling radius because a terminal velocity does.
 *
 * The failures are structural, not a naming accident. `divide({s:1},{s:1})` is
 * `{}`, and `1`, `ratio` and `%` are all dimensionless, so EVERY dimensionless
 * field is the dimensional rate of EVERY time field in its own type,
 * permanently. That is what the algebra says; no vocabulary work fixes it.
 *
 * So the scan's job is to ask a question, not to answer one. A new rate-bearing
 * field lands, the candidate set changes, this fails, and a person writes down
 * whether it is a real model or a coincidence. Recording the verdicts is the
 * point: a `coincidence` here is the same artefact as a declining
 * `registerReckoner` (the `targetReckoning.ts` shape), a record of a decision
 * taken, at a place the next person looks, that cannot rot without failing.
 *
 * It fails on a new candidate, on one that has vanished, and on a unit token no
 * descriptor declares. The last matters because a missing unit registration
 * would otherwise SHRINK the candidate set silently, which reads as progress.
 */

interface Verdict {
  /**
   * `real-but-unmodelled`: the sibling genuinely IS this quantity's rate, and
   * nobody has written the model. `coincidence`: the pairing is an artefact of
   * the dimensions and integrating it would invent motion.
   */
  verdict: "real-but-unmodelled" | "coincidence";
  /** The siblings the rule offered, because "which of these is the rate" is the question it cannot answer. */
  rates: string[];
  reason: string;
}

const verdicts = VERDICTS as Record<string, Verdict>;

function repoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(join(dir, "pnpm-workspace.yaml"))) dir = dirname(dir);
  return dir;
}

/** Every generated unit descriptor: core's, plus one per Uplink client. */
function descriptorPaths(root: string): string[] {
  const paths = [join(root, "mod/sitrep-sdk/src/__generated__/units.json")];
  const modDir = join(root, "mod");
  for (const entry of readdirSync(modDir)) {
    const candidate = join(
      modDir,
      entry,
      "client/src/__generated__/units.json",
    );
    if (existsSync(candidate)) paths.push(candidate);
  }
  return paths;
}

interface Descriptor {
  vocabulary: string[];
  types: Record<string, Record<string, string>>;
  topics: Record<string, Record<string, string>>;
}

/** Tokens that name a role rather than a quantity, so they measure nothing. */
const NON_QUANTITY = new Set(["text", "id", "flag", "enum", "n/a"]);

const root = repoRoot();
const descriptors = descriptorPaths(root).map(
  (path) => JSON.parse(readFileSync(path, "utf8")) as Descriptor,
);

/**
 * Tokens an Uplink declared for itself, which core's registry has never heard
 * of and cannot assign a dimension to. Legitimate: an Uplink models quantities
 * core does not know, and `UnitDescriptor` reflects its own `Units` catalog for
 * exactly that. The consequence is that this scan is BLIND to those fields, so
 * they are recorded rather than passed over silently.
 */
const opaqueTokens = new Set<string>();

/** Tokens used by a field that no registry declares at all. Drift, not a unit. */
const undeclaredTokens = new Set<string>();

function dimensionOf(
  token: string,
  ownVocabulary: ReadonlySet<string>,
): Readonly<Record<string, number>> | undefined {
  if (NON_QUANTITY.has(token)) return undefined;
  const definition = lookupUnit(token);
  if (definition) return definition.dim;
  if (ownVocabulary.has(token)) opaqueTokens.add(token);
  else undeclaredTokens.add(token);
  return undefined;
}

const PER_SECOND: Readonly<Record<string, number>> = { s: 1 };

/**
 * Every `owner.field <= rateSibling[, ...]` the rule proposes, over all
 * descriptors. The siblings are listed because "which of these is the rate"
 * is the question the rule cannot answer and a person can.
 */
function candidates(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const descriptor of descriptors) {
    const ownVocabulary = new Set(descriptor.vocabulary ?? []);
    for (const scope of [descriptor.types, descriptor.topics]) {
      for (const [owner, fields] of Object.entries(scope ?? {})) {
        for (const [field, token] of Object.entries(fields)) {
          const dim = dimensionOf(token, ownVocabulary);
          if (!dim) continue;
          const rateDim = Dimension.divide(dim, PER_SECOND);
          const siblings = Object.entries(fields)
            .filter(([name]) => name !== field)
            .filter(([, siblingToken]) => {
              const siblingDim = dimensionOf(siblingToken, ownVocabulary);
              return siblingDim !== undefined
                ? Dimension.equal(siblingDim, rateDim)
                : false;
            })
            .map(([name]) => name)
            .sort();
          if (siblings.length > 0) found.set(`${owner}.${field}`, siblings);
        }
      }
    }
  }
  return found;
}

const proposed = candidates();

describe("rate-integration candidates carry a written verdict", () => {
  it("proposes nothing that has not been judged", () => {
    const unjudged = [...proposed.keys()]
      .filter((key) => verdicts[key] === undefined)
      .sort();
    // A new rate-bearing field. Decide whether the pairing is a real model or
    // a coincidence and record it, either way, in reckoning-candidates.json.
    expect(unjudged).toEqual([]);
  });

  it("keeps no verdict for a candidate the rule no longer proposes", () => {
    // The ratchet half: a field renamed or a unit corrected makes its verdict
    // stale, and the entry has to go in the same commit that caused it.
    const stale = Object.keys(verdicts)
      .filter((key) => !proposed.has(key))
      .sort();
    expect(stale).toEqual([]);
  });

  it("reads no unit token that nothing declares", () => {
    // A token absent from core's registry AND from its own descriptor's
    // vocabulary is drift, and it makes its field invisible to this scan: a
    // candidate set that shrank because a unit went missing reads exactly like
    // progress.
    expect([...undeclaredTokens].sort()).toEqual([]);
  });

  it("names the Uplink-declared units this scan is blind to", () => {
    // Core's registry cannot assign a dimension to a unit an Uplink invented,
    // so fields carrying one never reach the sibling rule at all. That is the
    // correct division (an Uplink owns its own quantities) and a real gap in
    // the coverage, so it is written down rather than passed over. Kerbalism's
    // science-data rate is a genuine rate-integration case sitting inside it.
    // `bp`/`bp/s` are RP-1 build points and the rate progress advances at, and
    // they are the case this gate is blind to in its most load-bearing form:
    // the pairing IS real (an ETA is remaining points over that rate) and the
    // ETA is already derived from it server-side, efficiency-ramped and
    // sequenced against blocking peers, so there is nothing for a client to
    // integrate.
    expect([...opaqueTokens].sort()).toEqual([
      "MB",
      "MB/s",
      "bp",
      "bp/s",
      "confidence",
      "science/MB",
    ]);
  });

  it("finds real derivatives among the coincidences, and mostly coincidences", () => {
    // The guard on the guard, twice over. A scan proposing nothing would pass
    // every test above while telling nobody anything; and the reason this is a
    // ratchet rather than a classifier is that the pairing is USUALLY an
    // artefact, so if that ever stopped being true the case for deriving a
    // class by default would need revisiting.
    const kinds = Object.values(verdicts).map((v) => v.verdict);
    expect(
      kinds.filter((k) => k === "real-but-unmodelled").length,
    ).toBeGreaterThan(0);
    expect(kinds.filter((k) => k === "coincidence").length).toBeGreaterThan(
      kinds.filter((k) => k === "real-but-unmodelled").length,
    );
  });

  it("offers two or more candidate rates most of the time, so it cannot even pick one", () => {
    // The sharpest single number against derive-by-default: for most of the
    // set the rule proposes several siblings and has no way to choose between
    // them, so there is no default it could supply even where the pairing is
    // real.
    const ambiguous = [...proposed.values()].filter(
      (rates) => rates.length >= 2,
    ).length;
    expect(ambiguous * 2).toBeGreaterThan(proposed.size);
  });
});
