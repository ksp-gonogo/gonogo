# Encoded-transform delay spike

Throwaway harness for the investigation answered in
`local_docs/reports/encoded-transform-spike-report.md` (in the main
`gonogo` repo, not this worktree). Not part of the production build —
lives inside `mod/GonogoKerbcastUplink/client/` only so its Playwright driver scripts can
resolve the package's `node_modules/playwright` via normal Node ESM
resolution; nothing here is imported by kerbcast's own source or tests.

## What's here

- `harness-a.html` + `worker-a.js` — encoded-transform delay test. Loopback
  WebRTC (two in-page `RTCPeerConnection`s, canvas-captured source),
  `RTCRtpScriptTransform` on the receiver holds every encoded video frame
  for a fixed delay (default 4000ms) before writing it back into the
  pipeline. The source canvas encodes its own elapsed-ms timestamp as a
  32-bit black/white block barcode; the receiver reads it back off the
  rendered `<video>` via `requestVideoFrameCallback` + pixel sampling, so
  the measured delay is ground-truth (not inferred from WebRTC's own
  internal counters).
- `harness-b.html` — decoded-`VideoFrame` pool-exhaustion test, sourced
  directly from a `canvas.captureStream()` track (no WebRTC).
- `harness-c.html` — same pool-exhaustion test, but sourced from a real
  WebRTC **remote** track after decode (loopback `RTCPeerConnection`),
  which is architecturally what the current production Chrome backend
  does. Both B and C hold ~150-210 `VideoFrame`s without ever `close()`ing
  them and time every `reader.read()` to look for stalls.
- `server.mjs` — tiny static file server (no deps) so the harnesses run
  over `http://localhost` instead of `file://` (Worker/CORS behaviour is
  inconsistent under `file://` across engines, especially Firefox).
- `run-a.mjs` / `run-b.mjs` / `run-c.mjs` — Playwright drivers. Each
  launches chromium/firefox/webkit (or a single named engine as `argv[2]`),
  navigates to the harness, waits for `window.__harness*Result.done`, and
  prints the JSON result plus a one-line summary.

## Running

```
cd mod/GonogoKerbcastUplink/client/spike-encoded-transform-delay
node run-a.mjs            # all three engines
node run-a.mjs firefox    # one engine
node run-b.mjs chromium
node run-c.mjs chromium
```

Requires `nvm use` first (Node 24) and a `pnpm install` at the repo root so
`mod/GonogoKerbcastUplink/client/node_modules/playwright` exists with its cached browser
binaries.
