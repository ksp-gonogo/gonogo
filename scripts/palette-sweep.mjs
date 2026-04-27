#!/usr/bin/env node
/*
 * Apply palette decisions to the source tree.
 *
 * Reads:  local_docs/palette-decisions.json (human-authored)
 * Writes: local_docs/palette-decisions-final.json (refined, audit-friendly)
 *         + in-place edits across the workspace
 *
 * Pipeline:
 *   1. Parse the human decisions
 *   2. Apply fix-ups (light pinks → nogo-fg, alert-muted split, tag fg/bg/border split, etc.)
 *   3. Auto-pair undecided hexes to their closest existing-or-new token by ΔE
 *   4. Replace each raw hex with `var(<token>)` in source
 *
 * The new tokens themselves (CSS variables) are added separately to
 * packages/app/src/styles/global.css — done by hand so the diff is
 * reviewable.
 */

import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DECISIONS_IN = join(ROOT, "local_docs/palette-decisions.json");
const DECISIONS_OUT = join(ROOT, "local_docs/palette-decisions-final.json");
const TOKENS_CSS = join(ROOT, "packages/app/src/styles/global.css");

const SCAN_ROOTS = [
  "packages/app/src",
  "packages/components/src",
  "packages/core/src",
  "packages/data/src",
  "packages/serial/src",
  "packages/ui/src",
];

const ALLOWED_PATHS = new Set([
  "packages/app/src/styles/global.css",
  "packages/ui/src/themes/defaultDark.ts",
  "packages/core/src/registry.test.ts",
  "packages/core/src/stock-bodies.ts",
]);

// ---------------------------------------------------------------------------
// New tokens introduced by this sweep — keep in sync with global.css edits.
// Representative values picked from the user's grouping (most-frequent
// shade, or median lightness if frequencies tie).
// ---------------------------------------------------------------------------

const NEW_TOKENS = {
  // Status — muted alert variants
  "--color-status-alert-muted": "#4a0e0e",
  "--color-status-warning-bg-muted": "#3a2a0a",
  // Tag palette — fg / bg / border per colour
  "--color-tag-blue-fg": "#4488ff",
  "--color-tag-blue-bg": "#0a0a1a",
  "--color-tag-blue-border": "#1a1a3a",
  "--color-tag-purple-fg": "#cc44cc",
  "--color-tag-purple-bg": "#1a0a1a",
  "--color-tag-purple-border": "#6a3a9a",
  "--color-tag-yellow-fg": "#ffeb3b",
  "--color-tag-yellow-bg": "#3a2800",
  "--color-tag-yellow-border": "#6a5a2a",
  "--color-tag-dark-brown-bg": "#1a1000",
  "--color-tag-dark-brown-border": "#3a2800",
  "--color-tag-cyan-fg": "#00cccc",
  "--color-tag-orange-fg": "#ff6633",
  "--color-tag-red-fg": "#ff4466",
};

// ---------------------------------------------------------------------------
// Walk + colour math — duplicated from palette-audit.mjs because these are
// throwaway one-shot scripts and a shared module is overkill.
// ---------------------------------------------------------------------------

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name === "coverage")
      continue;
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) yield* walk(path);
    else if (/\.(tsx?|css)$/.test(name)) yield path;
  }
}

const HEX_RE =
  /#([0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})\b/g;

function hexToRgb(hex) {
  let h = hex.slice(1);
  if (h.length === 3 || h.length === 4) {
    h = h
      .slice(0, 3)
      .split("")
      .map((c) => c + c)
      .join("");
  } else if (h.length === 8) {
    h = h.slice(0, 6);
  }
  return [
    Number.parseInt(h.slice(0, 2), 16) / 255,
    Number.parseInt(h.slice(2, 4), 16) / 255,
    Number.parseInt(h.slice(4, 6), 16) / 255,
  ];
}

function rgbToLab([r, g, b]) {
  const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const [lr, lg, lb] = [lin(r), lin(g), lin(b)];
  let x = (lr * 0.4124 + lg * 0.3576 + lb * 0.1805) / 0.95047;
  let y = (lr * 0.2126 + lg * 0.7152 + lb * 0.0722) / 1.0;
  let z = (lr * 0.0193 + lg * 0.1192 + lb * 0.9505) / 1.08883;
  const f = (c) => (c > 0.008856 ? Math.cbrt(c) : 7.787 * c + 16 / 116);
  [x, y, z] = [f(x), f(y), f(z)];
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

function deltaE([l1, a1, b1], [l2, a2, b2]) {
  return Math.sqrt((l1 - l2) ** 2 + (a1 - a2) ** 2 + (b1 - b2) ** 2);
}

function hexToLab(hex) {
  return rgbToLab(hexToRgb(hex));
}

// ---------------------------------------------------------------------------
// Token table — existing (parsed from global.css) + new (declared above)
// ---------------------------------------------------------------------------

function buildTokenTable() {
  const css = readFileSync(TOKENS_CSS, "utf8");
  const tokens = new Map(); // name → hex
  for (const m of css.matchAll(
    /(--color-[a-z-]+)\s*:\s*(#[0-9a-fA-F]{3,8})/g,
  )) {
    tokens.set(m[1], m[2].toLowerCase());
  }
  for (const [name, hex] of Object.entries(NEW_TOKENS)) {
    tokens.set(name, hex.toLowerCase());
  }
  return tokens;
}

// ---------------------------------------------------------------------------
// Decision refinement — apply fix-ups to the human-authored JSON
// ---------------------------------------------------------------------------

// Direct overrides per hex value. The user's JSON had a few entries that
// needed adjustment after a closer look at the call site.
const FIXUPS = {
  // Light pinks were misrouted to text-primary; they're nogo-fg in fact.
  "#ffb4b4": "--color-status-nogo-fg",
  "#ff6666": "--color-status-nogo-fg",
  "#ffb0b0": "--color-status-nogo-fg",
  // The decision said new-token but the tokenName was an existing token.
  "#3a5a7a": "--color-status-info-fg",
  // Lavender used as text on a purple background — tag-fg.
  "#e0c8ff": "--color-tag-purple-fg",
  // Light yellow used as text on a yellow tag — tag-fg.
  "#e4d99e": "--color-tag-yellow-fg",
};

// Routes for the user's bundled "alert-muted" group: split into
// alert-muted (dark reds) vs warning-bg-muted (warm browns / olives).
const WARNING_BG_MUTED = new Set(["#663300", "#2a1a0a", "#3a2a0a"]);

// Routes for the user's flat "--color-tag-purple": split into fg/border
// based on the actual shade used at each call site.
const TAG_PURPLE_BORDER = new Set(["#6a3a9a"]); // dark purple → border
// All other "--color-tag-purple" decisions go to fg.

// Routes for the user's flat "--color-tag-yellow": fg vs border.
const TAG_YELLOW_BORDER = new Set(["#6a5a2a"]); // muted dark yellow → border
const TAG_YELLOW_BG = new Set([]); // none in current user decisions

// Routes for "--color-tag-dark-brown": user used flat name; split.
const TAG_DARK_BROWN_BORDER = new Set(["#3a2800"]); // border tone

function refineDecisions(rawDecisions, tokens) {
  const final = {};
  // Lowercase keys for stable lookup.
  for (const [hexRaw, dec] of Object.entries(rawDecisions)) {
    const hex = hexRaw.toLowerCase();

    // 1. Hard fixups override everything.
    if (FIXUPS[hex]) {
      final[hex] = { decision: "merge", target: FIXUPS[hex] };
      continue;
    }

    // 2. Decisions explicitly tagged as "keep" stay raw.
    if (dec.decision === "keep") {
      final[hex] = { ...dec };
      continue;
    }

    // 3. The user's "decision: new-token" form sometimes carried an
    //    inline "merge into <name>" instruction — normalize.
    if (dec.decision === "new-token") {
      const raw = String(dec.tokenName || "").trim();
      // Strip "merge into [new] " / "merge to [new] " prefixes.
      const cleaned = raw
        .replace(/^merge\s+into\s+(new\s+)?/i, "")
        .replace(/^merge\s+to\s+(new\s+)?/i, "")
        .trim();
      let target = cleaned;

      // Apply alert-muted vs warning-bg-muted split.
      if (target === "--color-status-alert-muted") {
        target = WARNING_BG_MUTED.has(hex)
          ? "--color-status-warning-bg-muted"
          : "--color-status-alert-muted";
      }

      // Apply flat tag-purple split.
      if (target === "--color-tag-purple") {
        target = TAG_PURPLE_BORDER.has(hex)
          ? "--color-tag-purple-border"
          : "--color-tag-purple-fg";
      }

      // Apply flat tag-yellow split.
      if (target === "--color-tag-yellow") {
        if (TAG_YELLOW_BORDER.has(hex)) target = "--color-tag-yellow-border";
        else if (TAG_YELLOW_BG.has(hex)) target = "--color-tag-yellow-bg";
        else target = "--color-tag-yellow-fg";
      }

      // Apply flat tag-dark-brown split.
      if (target === "--color-tag-dark-brown") {
        target = TAG_DARK_BROWN_BORDER.has(hex)
          ? "--color-tag-dark-brown-border"
          : "--color-tag-dark-brown-bg";
      }

      // Single-value flat tags (cyan/orange/red) become -fg by default.
      if (target === "--color-tag-cyan") target = "--color-tag-cyan-fg";
      if (target === "--color-tag-orange") target = "--color-tag-orange-fg";
      if (target === "--color-tag-red") target = "--color-tag-red-fg";

      if (!tokens.has(target)) {
        throw new Error(
          `Decision for ${hex} resolves to unknown token: ${target} ` +
            `(after refining "${raw}"). Add to NEW_TOKENS in this script ` +
            `and to global.css.`,
        );
      }
      final[hex] = { decision: "merge", target };
      continue;
    }

    // 4. Plain "merge" decisions are kept as-is, but validate the target
    //    is a known token.
    if (dec.decision === "merge") {
      if (!tokens.has(dec.target)) {
        throw new Error(
          `Decision for ${hex} targets unknown token: ${dec.target}.`,
        );
      }
      final[hex] = { decision: "merge", target: dec.target };
    }
  }

  return final;
}

// ---------------------------------------------------------------------------
// Auto-pair undecided hexes to closest token by ΔE
// ---------------------------------------------------------------------------

function findOffenders() {
  const offenders = new Map(); // hex → count
  for (const root of SCAN_ROOTS) {
    const abs = join(ROOT, root);
    if (!existsSync(abs)) continue;
    for (const file of walk(abs)) {
      const rel = relative(ROOT, file);
      if (ALLOWED_PATHS.has(rel)) continue;
      if (rel.includes(".test.")) continue;
      const content = readFileSync(file, "utf8");
      for (const m of content.matchAll(HEX_RE)) {
        const hex = m[0].toLowerCase();
        offenders.set(hex, (offenders.get(hex) || 0) + 1);
      }
    }
  }
  return offenders;
}

function autoPair(offenders, tokens, decided) {
  const tokenList = [...tokens.entries()].map(([name, hex]) => ({
    name,
    lab: hexToLab(hex),
  }));
  const auto = {};
  for (const hex of offenders.keys()) {
    if (decided[hex]) continue;
    const lab = hexToLab(hex);
    let bestName = null;
    let bestDist = Infinity;
    for (const t of tokenList) {
      const d = deltaE(lab, t.lab);
      if (d < bestDist) {
        bestDist = d;
        bestName = t.name;
      }
    }
    auto[hex] = {
      decision: "merge",
      target: bestName,
      autoPaired: true,
      distance: Number(bestDist.toFixed(2)),
    };
  }
  return auto;
}

// ---------------------------------------------------------------------------
// Sweep — replace raw hex with var(<token>) per decisions
// ---------------------------------------------------------------------------

function sweep(allDecisions) {
  let totalReplacements = 0;
  let filesTouched = 0;
  for (const root of SCAN_ROOTS) {
    const abs = join(ROOT, root);
    if (!existsSync(abs)) continue;
    for (const file of walk(abs)) {
      const rel = relative(ROOT, file);
      if (ALLOWED_PATHS.has(rel)) continue;
      if (rel.includes(".test.")) continue;
      const original = readFileSync(file, "utf8");
      let updated = original;
      let fileReplacements = 0;
      // Replace each hex token. Use a function callback so the lookup
      // happens once per match, lowercase-normalised.
      updated = updated.replace(HEX_RE, (match) => {
        const lower = match.toLowerCase();
        const dec = allDecisions[lower];
        if (!dec || dec.decision !== "merge") return match;
        fileReplacements++;
        return `var(${dec.target})`;
      });
      if (updated !== original) {
        writeFileSync(file, updated);
        filesTouched++;
        totalReplacements += fileReplacements;
      }
    }
  }
  return { filesTouched, totalReplacements };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const tokens = buildTokenTable();
const rawDecisions = JSON.parse(readFileSync(DECISIONS_IN, "utf8"));
const refined = refineDecisions(rawDecisions, tokens);
const offenders = findOffenders();
const auto = autoPair(offenders, tokens, refined);
const all = { ...refined, ...auto };

writeFileSync(DECISIONS_OUT, `${JSON.stringify(all, null, 2)}\n`);

const result = sweep(all);
console.log(
  `Wrote ${DECISIONS_OUT} — ${Object.keys(refined).length} explicit + ` +
    `${Object.keys(auto).length} auto-paired = ${Object.keys(all).length} total.`,
);
console.log(
  `Sweep: ${result.totalReplacements} replacements across ` +
    `${result.filesTouched} files.`,
);
