#!/usr/bin/env node
/*
 * One-shot tool: walk the source tree, tally raw hex colour literals,
 * cross-reference against the design-system tokens defined in
 * packages/app/src/styles/global.css, and emit a static HTML triage page
 * at local_docs/palette-audit.html.
 *
 * Usage:  node scripts/palette-audit.mjs
 *
 * The HTML page lets you decide, per distinct hex value, whether it
 * becomes an existing token, a new token, or stays raw. On submit it
 * downloads `palette-decisions.json` which feeds the follow-up sweep.
 *
 * Designed to be disposable — once the long tail is migrated and the
 * lint gate is enforcing, this script has no reason to exist.
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "local_docs/palette-audit.html");
const TOKENS_CSS = join(ROOT, "packages/app/src/styles/global.css");

const SCAN_ROOTS = [
  "packages/app/src",
  "packages/components/src",
  "packages/core/src",
  "packages/data/src",
  "packages/serial/src",
  "packages/ui/src",
];

// Files that legitimately contain raw hex values — sources of truth and
// fixtures. Excluded from the audit so they don't show up as offenders.
const ALLOWED_PATHS = new Set([
  "packages/app/src/styles/global.css",
  "packages/ui/src/themes/defaultDark.ts",
  "packages/core/src/registry.test.ts",
  "packages/core/src/stock-bodies.ts",
]);

// ---------------------------------------------------------------------------
// Walk + scan
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

function isInComment(line) {
  const trimmed = line.trim();
  return trimmed.startsWith("//") || trimmed.startsWith("*");
}

// ---------------------------------------------------------------------------
// Colour math: hex → LAB → ΔE76 (perceptual distance, not RGB)
// ---------------------------------------------------------------------------

function hexToRgb(hex) {
  let h = hex.slice(1);
  if (h.length === 3 || h.length === 4) {
    h = h
      .slice(0, 3)
      .split("")
      .map((c) => c + c)
      .join("");
  } else if (h.length === 8) {
    h = h.slice(0, 6); // strip alpha for distance calc
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
  // sRGB → XYZ (D65)
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
// Parse the CSS-variable token table from global.css
// ---------------------------------------------------------------------------

function parseTokens() {
  const css = readFileSync(TOKENS_CSS, "utf8");
  // Only pull `--color-*` tokens defined at the top level of :root.
  // Other CSS variables (--font-size-*, etc.) are ignored.
  const tokens = [];
  for (const m of css.matchAll(
    /(--color-[a-z-]+)\s*:\s*(#[0-9a-fA-F]{3,8})/g,
  )) {
    tokens.push({ name: m[1], hex: m[2].toLowerCase() });
  }
  return tokens;
}

// ---------------------------------------------------------------------------
// Scan the workspace
// ---------------------------------------------------------------------------

function scan() {
  const occurrences = new Map(); // hex → [{file, line, text, inComment}]
  for (const root of SCAN_ROOTS) {
    const abs = join(ROOT, root);
    for (const file of walk(abs)) {
      const rel = relative(ROOT, file);
      if (ALLOWED_PATHS.has(rel)) continue;
      if (rel.includes(".test.")) continue;
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((text, i) => {
        const matches = [...text.matchAll(HEX_RE)];
        for (const m of matches) {
          const hex = m[0].toLowerCase();
          if (!occurrences.has(hex)) occurrences.set(hex, []);
          occurrences.get(hex).push({
            file: rel,
            line: i + 1,
            text: text.trim(),
            inComment: isInComment(text),
          });
        }
      });
    }
  }
  return occurrences;
}

// ---------------------------------------------------------------------------
// Build the per-hex audit rows
// ---------------------------------------------------------------------------

function buildRows(occurrences, tokens) {
  const rows = [];
  for (const [hex, occs] of occurrences.entries()) {
    const lab = hexToLab(hex);
    // Closest tokens by ΔE — sorted nearest first, top 3.
    const ranked = tokens
      .map((t) => ({ ...t, distance: deltaE(lab, hexToLab(t.hex)) }))
      .sort((a, b) => a.distance - b.distance);
    const closest = ranked.slice(0, 3);
    // Exact matches (ΔE ≈ 0) mean this hex IS the value of one or more
    // existing tokens — call sites can swap in the token name without
    // any visual change. Multiple tokens may share a hex (e.g. accent.fg
    // and accent.bg).
    const exactMatches = ranked.filter((t) => t.distance < 0.5);
    rows.push({
      hex,
      count: occs.length,
      occurrences: occs,
      closest,
      ranked,
      exactMatches,
    });
  }
  // Highest-frequency rows first — biggest payoff for the triager.
  rows.sort((a, b) => b.count - a.count);
  return rows;
}

// ---------------------------------------------------------------------------
// HTML emission
// ---------------------------------------------------------------------------

function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderHtml({ rows, tokens, totalOccurrences }) {
  const tokenJson = JSON.stringify(tokens);
  const rowsHtml = rows
    .map((r, idx) => {
      const matchTag =
        r.exactMatches.length > 0
          ? `<span class="match-tag">↔ ${r.exactMatches.map((m) => m.name).join(" / ")} <small>(this hex is already a token value — swap is mechanical${r.exactMatches.length > 1 ? "; pick the role that fits the call site" : ""})</small></span>`
          : "";
      const closestSwatches = r.closest
        .map(
          (c) => `
            <div class="swatch-chip" title="ΔE ${c.distance.toFixed(1)} — perceptually ${c.distance < 2 ? "indistinguishable" : c.distance < 5 ? "very close" : c.distance < 12 ? "noticeably different" : "distinct"}">
              <span class="swatch" style="background:${c.hex}"></span>
              <code>${c.name}</code>
              <small>${c.hex} · ΔE ${c.distance.toFixed(1)}</small>
            </div>`,
        )
        .join("");
      const occsHtml = r.occurrences
        .map(
          (o) => `
            <li class="${o.inComment ? "in-comment" : ""}">
              <code>${escapeHtml(o.file)}:${o.line}</code>
              <span class="occ-text">${escapeHtml(o.text.length > 140 ? `${o.text.slice(0, 140)}…` : o.text)}</span>
              ${o.inComment ? '<span class="comment-tag">in comment</span>' : ""}
            </li>`,
        )
        .join("");
      // Dropdown sorted by perceptual distance (closest first) so the
      // likely target is at the top — but every token is still listed,
      // so non-perceptual decisions ("this is semantically a status colour
      // even though the closest neutral is grey-ish") remain reachable.
      const tokenOptions = r.ranked
        .map(
          (t) =>
            `<option value="merge:${t.name}">→ merge into ${t.name} (${t.hex}, ΔE ${t.distance.toFixed(1)})</option>`,
        )
        .join("");
      return `
        <article class="row" data-hex="${r.hex}" data-idx="${idx}">
          <header>
            <span class="swatch big" style="background:${r.hex}"></span>
            <div class="hex-meta">
              <h2><code>${r.hex}</code> <span class="count">×${r.count}</span></h2>
              ${matchTag}
            </div>
          </header>

          <section class="closest">
            <h3>Closest existing tokens</h3>
            <div class="swatch-row">${closestSwatches}</div>
          </section>

          <section class="decision">
            <h3>Decision</h3>
            <select class="decision-select" data-hex="${r.hex}">
              <option value="">— choose —</option>
              ${r.exactMatches
                .map(
                  (m, i) =>
                    `<option value="merge:${m.name}"${i === 0 ? " selected" : ""}>→ swap with ${m.name} (exact match)</option>`,
                )
                .join("")}
              ${tokenOptions}
              <option value="new">→ new token (specify name below)</option>
              <option value="keep">keep raw (specify reason below)</option>
            </select>
            <input class="decision-detail" placeholder="new token name OR reason for keeping" />
          </section>

          <details class="occurrences">
            <summary>${r.count} occurrence${r.count === 1 ? "" : "s"}</summary>
            <ul>${occsHtml}</ul>
          </details>
        </article>`;
    })
    .join("");

  const tokenRefHtml = tokens
    .map(
      (t) => `
        <div class="token-card">
          <span class="swatch" style="background:${t.hex}"></span>
          <div>
            <code>${t.name}</code>
            <small>${t.hex}</small>
          </div>
        </div>`,
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Palette audit · gonogo</title>
<style>
  :root {
    --bg: #0d0d0d;
    --panel: #1a1a1a;
    --border: #2a2a2a;
    --text: #ccc;
    --muted: #888;
    --dim: #666;
    --accent: #00ff88;
  }
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    background: var(--bg);
    color: var(--text);
    font-family: ui-monospace, "JetBrains Mono", Menlo, Consolas, monospace;
    font-size: 14px;
    line-height: 1.5;
  }
  body { padding: 32px; max-width: 1200px; margin: 0 auto; }
  h1, h2, h3 { font-weight: 700; letter-spacing: 0.05em; margin: 0; }
  h1 { font-size: 22px; margin-bottom: 8px; }
  h2 { font-size: 18px; }
  h3 { font-size: 11px; text-transform: uppercase; color: var(--muted); margin-bottom: 8px; letter-spacing: 0.15em; }
  .lede { color: var(--muted); margin-bottom: 24px; }
  .swatch { display: inline-block; width: 24px; height: 24px; border-radius: 4px; border: 1px solid #00000060; vertical-align: middle; }
  .swatch.big { width: 64px; height: 64px; border-radius: 6px; }
  code { background: var(--panel); padding: 1px 6px; border-radius: 3px; font-size: 13px; }
  small { color: var(--dim); font-size: 11px; }

  .token-ref {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 16px;
    margin-bottom: 32px;
  }
  .token-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 8px;
    margin-top: 12px;
  }
  .token-card {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 8px;
    background: #0a0a0a;
    border: 1px solid var(--border);
    border-radius: 4px;
  }
  .token-card code { font-size: 11px; padding: 0; background: transparent; }
  .token-card div { display: flex; flex-direction: column; }

  .row {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 20px;
    margin-bottom: 16px;
  }
  .row header { display: flex; align-items: center; gap: 16px; margin-bottom: 16px; }
  .hex-meta { display: flex; flex-direction: column; gap: 4px; }
  .count { color: var(--muted); font-size: 14px; font-weight: 400; }
  .match-tag {
    color: var(--accent);
    font-size: 12px;
  }
  .match-tag small { color: var(--dim); margin-left: 6px; }

  .closest { margin-bottom: 16px; }
  .swatch-row { display: flex; gap: 12px; flex-wrap: wrap; }
  .swatch-chip {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    background: #0a0a0a;
    border: 1px solid var(--border);
    border-radius: 4px;
    font-size: 12px;
  }
  .swatch-chip code { background: transparent; padding: 0; font-size: 11px; }
  .swatch-chip small { font-size: 10px; }

  .decision { margin-bottom: 12px; }
  .decision-select, .decision-detail {
    background: #0a0a0a;
    border: 1px solid var(--border);
    color: var(--text);
    font-family: inherit;
    font-size: 13px;
    padding: 6px 8px;
    border-radius: 3px;
  }
  .decision-select { min-width: 360px; margin-right: 8px; }
  .decision-detail { width: 360px; }
  .decision-select:focus, .decision-detail:focus {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
    border-color: var(--accent);
  }

  details { margin-top: 8px; }
  summary {
    cursor: pointer;
    color: var(--muted);
    font-size: 12px;
    user-select: none;
  }
  summary:hover { color: var(--text); }
  details ul { list-style: none; padding: 0; margin: 8px 0 0 0; max-height: 320px; overflow-y: auto; }
  details li {
    padding: 4px 8px;
    border-bottom: 1px solid #1f1f1f;
    font-size: 11px;
    line-height: 1.4;
  }
  details li.in-comment { opacity: 0.5; }
  .occ-text { color: var(--muted); margin-left: 8px; }
  .comment-tag {
    background: #2a1010;
    color: #ffaaaa;
    padding: 0 6px;
    border-radius: 3px;
    font-size: 9px;
    margin-left: 6px;
  }

  .toolbar {
    position: sticky;
    top: 0;
    background: #0d0d0dee;
    backdrop-filter: blur(6px);
    padding: 16px 0;
    border-bottom: 1px solid var(--border);
    margin-bottom: 24px;
    z-index: 10;
    display: flex;
    align-items: center;
    gap: 16px;
  }
  button {
    background: var(--accent);
    color: #0a0a0a;
    border: none;
    padding: 8px 16px;
    font-family: inherit;
    font-size: 13px;
    font-weight: 700;
    border-radius: 3px;
    cursor: pointer;
    letter-spacing: 0.05em;
  }
  button.secondary {
    background: var(--panel);
    color: var(--text);
    border: 1px solid var(--border);
  }
  button:hover { filter: brightness(1.1); }
  .progress { color: var(--muted); font-size: 12px; }
</style>
</head>
<body>
  <h1>Palette audit</h1>
  <p class="lede">
    ${rows.length} distinct raw hex values across ${totalOccurrences} occurrences in workspace source
    (excluding tests, <code>global.css</code>, and the registered theme).
    Decide per row, then click <strong>Download decisions</strong> to feed the follow-up sweep.
  </p>

  <div class="toolbar">
    <button id="download">Download decisions</button>
    <button class="secondary" id="export-summary">Export summary as text</button>
    <span class="progress" id="progress">0 / ${rows.length} decided</span>
  </div>

  <section class="token-ref">
    <h3>Existing tokens (from <code>global.css</code>)</h3>
    <div class="token-grid">${tokenRefHtml}</div>
  </section>

  ${rowsHtml}

  <script>
    const TOKENS = ${tokenJson};
    const decisions = {};
    const selects = document.querySelectorAll(".decision-select");
    const details = document.querySelectorAll(".decision-detail");
    const progress = document.getElementById("progress");

    function update() {
      let decided = 0;
      for (const sel of selects) if (sel.value) decided++;
      progress.textContent = decided + " / " + selects.length + " decided";
    }

    for (const sel of selects) {
      const hex = sel.dataset.hex;
      const row = sel.closest(".row");
      const detail = row.querySelector(".decision-detail");
      detail.dataset.hex = hex;
      const sync = () => {
        decisions[hex] = { value: sel.value, detail: detail.value };
        update();
      };
      sel.addEventListener("change", sync);
      detail.addEventListener("input", sync);
      // Pre-fill exact-match decisions so triage starts with progress.
      if (sel.value) sync();
    }
    update();

    function buildOutput() {
      const out = {};
      for (const [hex, d] of Object.entries(decisions)) {
        if (!d.value) continue;
        if (d.value.startsWith("merge:")) {
          out[hex] = { decision: "merge", target: d.value.slice("merge:".length) };
        } else if (d.value === "new") {
          out[hex] = { decision: "new-token", tokenName: d.detail };
        } else if (d.value === "keep") {
          out[hex] = { decision: "keep", reason: d.detail };
        }
      }
      return out;
    }

    document.getElementById("download").addEventListener("click", () => {
      const out = buildOutput();
      const blob = new Blob([JSON.stringify(out, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "palette-decisions.json";
      a.click();
    });

    document.getElementById("export-summary").addEventListener("click", () => {
      const out = buildOutput();
      const lines = Object.entries(out).map(([hex, d]) => {
        if (d.decision === "merge") return hex + "  →  " + d.target;
        if (d.decision === "new-token") return hex + "  →  new token: " + d.tokenName;
        if (d.decision === "keep") return hex + "  →  keep (" + d.reason + ")";
        return "";
      });
      const text = lines.join("\\n");
      const blob = new Blob([text], { type: "text/plain" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "palette-decisions.txt";
      a.click();
    });
  </script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const tokens = parseTokens();
const occurrences = scan();
const totalOccurrences = [...occurrences.values()].reduce(
  (s, arr) => s + arr.length,
  0,
);
const rows = buildRows(occurrences, tokens);
const html = renderHtml({ rows, tokens, totalOccurrences });
writeFileSync(OUT, html);
console.log(
  `Wrote ${OUT} — ${rows.length} distinct hex values, ${totalOccurrences} total occurrences, ${tokens.length} existing tokens.`,
);
