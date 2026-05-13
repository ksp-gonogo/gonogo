#!/usr/bin/env node
// Decode a bug-report Axiom entry into:
//   <out>/screenshot.jpg     (the user's screenshot; only if the entry has one)
//   <out>/recent-logs.json   (the recent-logs slice, pretty-printed)
//   <out>/summary.txt        (one-line message + key context)
//
// Usage:
//   1. In Axiom, copy a single bug-report row's full JSON into a file (e.g.
//      `~/Downloads/bug-report.json`).
//   2. node scripts/decode-bug-report.mjs ~/Downloads/bug-report.json [outDir]
//      (outDir defaults to /tmp/bug-report)
//
// Why this exists: dropping the ~10–15 KB screenshot.base64 field into a
// Claude Code conversation reliably triggers an SSE-stall freeze when Claude
// tries to round-trip it into a Write tool call. Decode here, then hand
// Claude only the resulting `.jpg` path — Read can ingest images directly.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const [, , inputArg, outArg] = process.argv;
if (!inputArg) {
  console.error(
    "usage: node scripts/decode-bug-report.mjs <path-to-entry.json> [outDir]",
  );
  process.exit(1);
}

const inputPath = resolve(inputArg);
const outDir = resolve(outArg ?? "/tmp/bug-report");
mkdirSync(outDir, { recursive: true });

const raw = readFileSync(inputPath, "utf8");
let entry;
try {
  entry = JSON.parse(raw);
} catch (err) {
  console.error(`Could not parse JSON from ${inputPath}: ${err.message}`);
  process.exit(1);
}

// Axiom sometimes wraps the row in `{ data: { ... } }` and sometimes returns
// the bare entry. Normalise both shapes.
const data = entry.data ?? entry;
const payload = data.context?.bug_report;
if (!payload) {
  console.error(
    "Entry has no `context.bug_report` field — is this really a bug-report row?",
  );
  process.exit(1);
}

const summaryLines = [
  `message: ${data.message ?? "(none)"}`,
  `device:  ${data.device?.role ?? "?"} ${data.device?.id ?? ""}`.trim(),
  `session: ${data.sessionId ?? "(none)"}`,
  `at:      ${data.timestamp ?? "(none)"}`,
  `window:  ${payload.timeWindowMinutes ?? "all"} min`,
  `logs:    ${payload.recentLogsCount ?? payload.recentLogs?.length ?? 0} entries`,
];
if (payload.screenshot) {
  summaryLines.push(
    `image:   ${payload.screenshot.width}x${payload.screenshot.height} ${payload.screenshot.mimeType} (${payload.screenshot.encodedSize} bytes)`,
  );
}

const summaryPath = resolve(outDir, "summary.txt");
writeFileSync(summaryPath, `${summaryLines.join("\n")}\n`);

const logsPath = resolve(outDir, "recent-logs.json");
writeFileSync(
  logsPath,
  `${JSON.stringify(payload.recentLogs ?? [], null, 2)}\n`,
);

let screenshotPath = null;
if (payload.screenshot?.base64) {
  const ext = payload.screenshot.mimeType === "image/png" ? "png" : "jpg";
  screenshotPath = resolve(outDir, `screenshot.${ext}`);
  writeFileSync(
    screenshotPath,
    Buffer.from(payload.screenshot.base64, "base64"),
  );
}

console.log(`summary: ${summaryPath}`);
console.log(`logs:    ${logsPath}`);
if (screenshotPath) console.log(`image:   ${screenshotPath}`);
else console.log("image:   (none in this entry)");
