// @vitest-environment node
/*
 * esbuild is used to load the allowlist as it stood at the base ref, and it
 * needs the real Node TextEncoder realm: under jsdom it refuses to start at
 * all, with an invariant error about Uint8Array rather than anything that
 * names this file.
 */
import { existsSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { transformSync } from "esbuild";
import { describe, expect, it } from "vitest";
import {
  type RatchetBase,
  ratchetBaseRef,
  sourceAtRatchetBase,
} from "./ratchetBaseRef";
import {
  ALLOWLIST,
  type ModAllowlist,
  type ModToken,
  SURVIVES_COMMENT_STRIP,
} from "./uplink-boundary.allowlist";

/** Local, as in every other scan in this package: it is four lines and
 *  exporting it would make one more shared surface for no gain. */
function findRepoRoot(start: string): string {
  let dir = start;
  while (dir !== "/") {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = dirname(dir);
  }
  throw new Error(`Could not locate workspace root from ${start}`);
}

/**
 * The `permanent` bucket's code-carrying subset only ever shrinks.
 *
 * <p><b>Why this exists.</b> `uplink-boundary.allowlist.ts` has two buckets and
 * the mechanical gate is on the smaller one. `domainDebt` holds ELEVEN entries
 * and is shrink-only, enforced against a base git ref. `permanent` holds THREE
 * HUNDRED AND FOUR and is unconstrained by design: its own doc says "add or
 * remove via a normal reviewed edit". So the ratchet's teeth are on about three
 * percent of the surface.</p>
 *
 * <p>That asymmetry does not merely leave a gap, it creates PRESSURE toward it.
 * A genuine new violation cannot be recorded as `domainDebt`, because that gate
 * refuses growth outright, and the refusal message says in as many words to put
 * it in `permanent` instead. The only bucket a new coupling can be written down
 * in is the one nothing checks.</p>
 *
 * <p><b>It has already happened once.</b>
 * `mod/Sitrep.Host/ActionGroups/ActionGroupsElection.cs` sat in `permanent`
 * justified as "constant/method names ... and prose", while being a public
 * `RegisterActionGroupsExtendedProvider` plus two constants: code coupling, so
 * `domainDebt` by the file's own definition. The note left behind when it was
 * finally removed says "Naming the API symbols in the justification should have
 * been the tell." No gate found it. A person reading a justification did.</p>
 *
 * <p><b>What this gate adds.</b> Not a fourth bucket and not a re-litigation of
 * the 304: it grades only the subset that can hide real coupling, and freezes
 * that. An entry qualifies when all three hold:</p>
 *
 * <ol>
 *   <li>it is in some token's `permanent`, and</li>
 *   <li>it appears in `SURVIVES_COMMENT_STRIP`, which is this repo's own
 *       existing notion of "the mod's name is still there once comments are
 *       removed", i.e. the file carries CODE and not only prose, and</li>
 *   <li>it is not one of the file KINDS the bucket legitimately covers.</li>
 * </ol>
 *
 * <p>Tests are excluded as a kind of their own: a test for a mod's wire
 * behaviour has to name the mod, and there is nothing to move.</p>
 *
 * <p>The result is small enough to read: thirteen entries when this was
 * seeded, eight of them outside any owning mod directory. Freezing thirteen
 * costs nothing and closes the only route by which the other 291 could grow
 * into something they are not.</p>
 *
 * <p><b>Proven able to fail.</b> Planting
 * `packages/app/src/planted-violation.tsx` into BOTH `kerbcast.permanent` and
 * `SURVIVES_COMMENT_STRIP.kerbcast` turns the git-backed test red naming it:
 * "New CODE-CARRYING entries in ALLOWLIST.&lt;token&gt;.permanent vs HEAD~1 ...
 * kerbcast -&gt; packages/app/src/planted-violation.tsx". Planting into only ONE
 * of the two lists correctly does NOT fire, since an entry has to be both
 * excused and code-carrying to qualify.</p>
 *
 * <p><b>It is inert when the base ref IS the commit under test</b>, which is
 * every freshly-pushed branch, and it shares that with every other shrink-only
 * gate here: `ratchetBaseRef()` returns null and the test returns early. That
 * is why the demonstration above sets `RATCHET_BASE_REF=HEAD~1` explicitly. A
 * gate that returns early reports success, so do not read a local pass as
 * evidence it ran; `ratchet-base-ref.test.ts` is what grades base resolution,
 * in one place for the whole family.</p>
 *
 * <p><b>What it deliberately does NOT do.</b> It does not forbid a new
 * sanctioned KIND. If a genuinely new sort of wire or inventory file appears,
 * adding its pattern below is a reviewed edit, which is the same standard the
 * `permanent` bucket already holds itself to. The difference is that the edit
 * is now visible as a change to a RULE rather than invisible as one more line
 * among hundreds.</p>
 *
 * <p><b>The seed grandfathers, it does not bless.</b> Because the check is
 * against a base ref, everything already in `permanent` when this landed is
 * tolerated whether or not it matches a sanctioned kind, and nothing says which
 * is which. `packages/app/src/main.tsx` was the first case to surface: five
 * tokens carried it, a sixth carried the identical line in `domainDebt`, and
 * moving that sixth across to match the other five is what made this gate
 * speak. It was given a sanctioned kind of its own, whose stated reason was that
 * the app bundles each Uplink client so one file must import every one of them
 * and there is nothing to move. That reason expired on 2026-08-31, when the
 * imports moved to the runtime loader: `main.tsx` names no Uplink now, its
 * twelve allowlist entries are gone, and the kind went with them. Worth
 * remembering as the one case where a sanctioned kind turned out to be a
 * mechanism nobody had tried to remove yet, rather than a job the file
 * genuinely had.</p>
 */

/**
 * File kinds where naming a mod in code is the file's actual job, so an entry
 * for one is a description rather than a debt. Each carries its reason: a
 * pattern nobody can justify is a pattern that should not be here.
 */
const SANCTIONED_KINDS: ReadonlyArray<{ pattern: RegExp; why: string }> = [
  {
    pattern: /__generated__\//,
    why: "codegen output, the wire shape names whatever the contract declares",
  },
  {
    pattern: /^mod\/Sitrep\.Contract\//,
    why: "the contract itself, where a seam an Uplink implements has to live",
  },
  {
    pattern: /\.allowlist\.ts$/,
    why: "a ratchet's own inventory, which enumerates every Uplink by design",
  },
  {
    pattern: /debt\.(ts|mjs)$/,
    why: "same: a debt list keyed by Uplink or by widget directory",
  },
  {
    pattern: /^scripts\/uplink-/,
    why: "the Uplink tooling, whose whole subject is the set of Uplinks",
  },
  {
    // Added 2026-09-04, when the boundary walk widened past `src` and reached
    // these for the first time. Same kind as the line above, one directory
    // over: the app's Uplink bundle registry (id, repo, clientDir per Uplink)
    // and the size gate over the bundles it produces. Enumerating every Uplink
    // is the subject of both, and neither has code to move.
    pattern: /^packages\/app\/(uplink-bundle|scripts\/minsize-)/,
    why: "the app's Uplink bundling and the size gate over its output, whose subject is the set of Uplink bundles",
  },
  {
    // Also 2026-09-04. What these name is a fixture DIRECTORY or a topic id in
    // a replayed scene, never an import: an import from here is real coupling
    // and lands in `domainDebt`, because the comment-strip check forces that
    // classification before anything can reach this bucket. `uplink-isolation`
    // already treats `/scripts/` as test-only code for exactly this reason.
    pattern: /^packages\/[^/]+\/scripts\//,
    why: "the visual-gate probe and render harness: fixture paths and replayed topic ids, which is how a scene says what it is a picture of",
  },
  {
    pattern: /^packages\/[^/]+\/vitest\.config\.ts$/,
    why: "a test-runner alias map, naming which Uplink client resolves from source so a suite sees its registrations",
  },
  { pattern: /^docs\//, why: "prose" },
  { pattern: /\.md$/, why: "prose" },
  { pattern: /^CLAUDE\.md$/, why: "prose" },
  {
    pattern: /uplink-isolation/,
    why: "the isolation gate, which names what it isolates",
  },
];

/** A test naming a mod has nothing to move: the mod IS its subject. */
function isTestFile(path: string): boolean {
  return /\.test\.|\.gate\.test\.|\/__tests__\/|Tests?\.cs$/.test(path);
}

function sanctioned(path: string): boolean {
  return SANCTIONED_KINDS.some(({ pattern }) => pattern.test(path));
}

/**
 * Every `permanent` entry that carries code and is not a sanctioned kind, as
 * `token::path` so two tokens listing one file stay distinguishable.
 *
 * <p>Pure, and shared by the synthetic test below and the git-backed one, so
 * both exercise the same rule rather than two descriptions of it.</p>
 */
function codeCarryingPermanent(
  allowlist: Partial<Record<ModToken, ModAllowlist | string[]>>,
  survives: Partial<Record<ModToken, string[]>>,
): string[] {
  const out: string[] = [];
  for (const [token, entry] of Object.entries(allowlist)) {
    /* The pre-split flat shape: treat the whole list as permanent, which is
     * conservative and cannot false-fail the commit that introduced the
     * split. */
    const permanent = Array.isArray(entry) ? entry : (entry?.permanent ?? []);
    const carriesCode = new Set(survives[token as ModToken] ?? []);
    for (const path of permanent) {
      if (!carriesCode.has(path)) continue;
      if (sanctioned(path) || isTestFile(path)) continue;
      out.push(`${token}::${path}`);
    }
  }
  return out.sort();
}

async function moduleAtBase(
  base: RatchetBase,
  relPath: string,
): Promise<{
  ALLOWLIST: Partial<Record<ModToken, ModAllowlist | string[]>>;
  SURVIVES_COMMENT_STRIP: Partial<Record<ModToken, string[]>>;
} | null> {
  const source = sourceAtRatchetBase(base, relPath);
  if (source === null) return null;
  const { code } = transformSync(source, { loader: "ts", format: "esm" });
  const mod = await import(`data:text/javascript,${encodeURIComponent(code)}`);
  return {
    ALLOWLIST: mod.ALLOWLIST ?? {},
    /* Absent at a base that predates the comment-strip check: an empty map
     * makes every current entry look new, which would fail the commit that
     * adds it, so the caller treats a missing map as "cannot grade". */
    SURVIVES_COMMENT_STRIP: mod.SURVIVES_COMMENT_STRIP,
  };
}

describe("uplink boundary: the permanent bucket's code-carrying subset only shrinks", () => {
  it("grades a file that carries code, and spares the kinds that must name a mod", () => {
    const allowlist = {
      kerbalism: {
        permanent: [
          "packages/app/src/SomeWidget.tsx",
          "mod/sitrep-sdk/src/__generated__/contract.ts",
          "packages/core/src/thing.allowlist.ts",
          "packages/app/src/SomeWidget.test.tsx",
          "docs/uplink-isolation.md",
          "packages/app/src/ProseOnly.tsx",
        ],
        domainDebt: [],
      },
    } as Partial<Record<ModToken, ModAllowlist>>;
    const survives = {
      kerbalism: [
        "packages/app/src/SomeWidget.tsx",
        "mod/sitrep-sdk/src/__generated__/contract.ts",
        "packages/core/src/thing.allowlist.ts",
        "packages/app/src/SomeWidget.test.tsx",
        "docs/uplink-isolation.md",
        // ProseOnly deliberately absent: comments only, so it never grades.
      ],
    };

    expect(codeCarryingPermanent(allowlist, survives)).toEqual([
      "kerbalism::packages/app/src/SomeWidget.tsx",
    ]);
  });

  it("sees growth, which is the whole point and is easy to write blind", () => {
    const before = {
      kos: { permanent: ["packages/app/src/A.tsx"], domainDebt: [] },
    } as Partial<Record<ModToken, ModAllowlist>>;
    const after = {
      kos: {
        permanent: ["packages/app/src/A.tsx", "packages/app/src/B.tsx"],
        domainDebt: [],
      },
    } as Partial<Record<ModToken, ModAllowlist>>;
    const survives = {
      kos: ["packages/app/src/A.tsx", "packages/app/src/B.tsx"],
    };

    const gained = codeCarryingPermanent(after, survives).filter(
      (e) => !codeCarryingPermanent(before, survives).includes(e),
    );
    expect(gained).toEqual(["kos::packages/app/src/B.tsx"]);
  });

  it("no token filed new code-carrying permanent entries vs the base ref", async () => {
    const base = ratchetBaseRef();
    if (!base) return; // the checkout IS the base, nothing to diff

    const root = findRepoRoot(dirname(fileURLToPath(import.meta.url)));
    const relPath = relative(
      root,
      join(
        dirname(fileURLToPath(import.meta.url)),
        "uplink-boundary.allowlist.ts",
      ),
    );
    const previous = await moduleAtBase(base, relPath);
    /* Absent file, or a base predating the comment-strip map: cannot grade.
     * `ratchet-base-ref.test.ts` grades base resolution itself, in one
     * place. */
    if (!previous?.SURVIVES_COMMENT_STRIP) return;

    const before = new Set(
      codeCarryingPermanent(
        previous.ALLOWLIST,
        previous.SURVIVES_COMMENT_STRIP,
      ),
    );
    const now = codeCarryingPermanent(ALLOWLIST, SURVIVES_COMMENT_STRIP);
    const added = now.filter((entry) => !before.has(entry));

    if (added.length > 0) {
      throw new Error(
        `New CODE-CARRYING entries in ALLOWLIST.<token>.permanent vs ${base.ref}. ` +
          `Each of these names a mod in CODE (it survives comment-stripping), from a ` +
          `file that is not generated, not the contract, not a ratchet inventory, not ` +
          `docs and not a test. That is real coupling, and the permanent bucket is for ` +
          `files whose JOB is naming the mod:\n` +
          added.map((e) => `  ${e.replace("::", "  ->  ")}`).join("\n") +
          `\n\nMove the code into the owning Uplink instead of filing it. If the file ` +
          `genuinely is a kind that has to name a mod, add its pattern to ` +
          `SANCTIONED_KINDS in uplink-permanent-code.test.ts WITH a reason, which is a ` +
          `change to a rule and gets read as one.`,
      );
    }
    expect(added).toEqual([]);
  });
});
