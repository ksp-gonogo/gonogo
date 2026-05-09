# Feature log

One entry per substantial piece of work. Used to:

1. Reconstruct what shipped and why, weeks or months after the fact.
2. Track **validation state** — has the work been exercised in a live session,
   not just CI? An unvalidated entry is a candidate suspect for any new bug,
   even if it isn't the work currently in flight.

Entries are checked into git so the log survives a machine swap and is shared
with collaborators. Planning docs stay in `local_docs/` (gitignored) — entries
may link to them but expect those links to dead-end on a fresh checkout.

## When to add an entry

Add an entry when *any* of these is true:

- The work spans more than one commit.
- The work was driven by a planning doc in `local_docs/`.
- The user explicitly asked for a log.
- The change touches a wire format, persistence schema, or other contract that
  could regress silently in someone else's session.

Trivial bugfixes and one-line tweaks don't need an entry.

## Validation states

- **⏳ pending** — landed and tested in CI, but not yet exercised in a real
  KSP / multi-screen session by the user. **Treat as a regression suspect**
  until promoted.
- **✅ confirmed YYYY-MM-DD** — the user has confirmed the feature works as
  intended in a live session.
- **🪦 superseded by `<entry>`** — the work has been replaced or removed by a
  later entry. Keep the link for archaeology; don't delete.

## Regression workflow

When the user reports a bug, **scan this index first** for entries marked
pending. The bug is just as likely to be in unvalidated work as in the work
currently in flight. The 2026-05-08 incident is the canonical example: a bug
that looked like it came from active work was actually a regression in the
piece shipped immediately before.

## Entries (newest first)

- 2026-05-09 — [Action-group alarm UI](2026-05-09-action-group-alarm-ui.md) — `6c81cd6` — ⏳ pending
