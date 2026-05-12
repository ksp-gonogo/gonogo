# Bug report form (Diagnostics & Logs)

## Why

We ship logs to Axiom (`gonogo` dataset) and have a Diagnostics & Logs modal
with "Copy report"/Download buttons that bundle a snapshot for me to inspect,
but the user has no self-service way to send a report back. Today the path is
"user pings me, I ask them to copy and paste". This adds an in-app form so a
report — description + recent logs + optional screenshot — lands directly in
Axiom under a `bug-report` tag I can query on a regular basis.

## Shipped

- New **Report bug** section at the bottom of `LogsManager.tsx`. Collapsed-to-
  button by default; on click it expands to a small form: description
  textarea, "Include logs from" select (1 / 5 (default) / 15 min / everything
  in buffer), optional screenshot upload (using the new `FileInput` primitive
  in `@gonogo/ui` so the dark theme reads correctly), Send / Cancel.
- On submit, calls
  `logger.tag("bug-report").error(description, undefined, { bug_report: { ... } })`
  + `logger.flushTransports()`. The existing AxiomTransport fan-out picks it
  up; no logger-package changes. Auto-collapses with a 5s success notice.
- New helper `recentLogsWindow.ts` slices `logger.getBuffer()` by minute
  window (`null` = full buffer). Pure + injectable `now`, fully unit-tested.
- New helper `screenshotEncoder.ts`: `File` → resized JPEG base64. Resizes
  longest edge to ≤1600 px, JPEG q=0.8. Warns at >700 KB encoded, refuses at
  >1.5 MB to keep Axiom events under their per-event size limit.
- Added `bug-report` to the curated `KNOWN_TAGS` list so it's discoverable in
  the Active tags toggle UI.

## Not changed

- `@gonogo/logger` is untouched. The `tag().error()` + transport fan-out +
  auto-attached identity already cover everything needed.

## Axiom query

```kusto
['gonogo']
| where tag == "bug-report"
| sort by _time desc
| project _time, ['device.role'], ['device.id'], message,
          ['context.bug_report.timeWindowMinutes'],
          ['context.bug_report.recentLogsCount'],
          ['context.bug_report.screenshot']
```

## Tests

- `recentLogsWindow.test.ts` — boundary, empty buffer, null=full, unparseable
  timestamp, all-outside.
- `LogsManager.test.tsx` — submit emits the right entry shape; submit
  disabled when description empty; window-change re-renders the count hint;
  success notice + auto-collapse after 5s; Cancel doesn't emit.
- `pnpm --filter @gonogo/app test` — 393 passed (51 files). `pnpm lint`,
  `pnpm --filter @gonogo/app typecheck` — clean.

## Validation

✅ confirmed 2026-05-13 — submitted a live `Hello, Claude!` test report from
the deployed build. Axiom entry landed with full `context.bug_report` shape;
recent-logs slice carried 6 entries from a real OCISLY peer-failure
sequence; the resized 600×440 / ~10 KB JPEG decoded cleanly and was readable
end-to-end. Bug-report → Axiom round-trip works.

## ⚠️ Operational caveat — don't try to read screenshots in-band

The `screenshot.base64` field is ~10–15 KB per entry. Pulling it into a
Claude Code conversation context (via `mcp__axiom__queryDataset` or by
having the user paste the JSON) reliably triggers a Claude Code SSE-stall
freeze the moment Claude tries to emit a `Write` tool call carrying the
base64 as the `content` parameter. This was reproduced on Opus 4.7 and Haiku
4.5, both as the parent agent and as a delegated subagent.

**Workflow when investigating a bug-report entry:**

1. Read the metadata, message, and `recentLogs` slice freely — those are
   small.
2. Decode the screenshot **outside** Claude Code:
   ```
   node scripts/decode-bug-report.mjs ~/Downloads/entry.json /tmp/bug-report
   ```
   Writes `screenshot.jpg`, `recent-logs.json`, and `summary.txt` to the
   output dir. Accepts both bare-entry and `{ data: ... }` shapes that
   Axiom returns from different export paths.
3. Hand Claude the **file path** — `Read` renders images natively, no
   base64 in text context.

Don't ask Claude to "save the base64 to a file" or "decode it for me" —
that's the freeze trigger. Don't paste the full JSON entry into chat.

## Plan

`local_docs/plans/i-want-a-new-quizzical-flurry.md` (Claude Code plan file).
