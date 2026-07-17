# Licensing

**gonogo is MIT. `GonogoKos` is GPL-3.0-only, because it links kOS and kOS is GPL-3.0. If you
don't touch `GonogoKos`, MIT is all you need to know.**

That's the whole rule. The rest of this file is the detail behind it.

## Writing an Uplink or a widget

You need `@ksp-gonogo/sitrep-sdk`, `@ksp-gonogo/core`, and `@ksp-gonogo/ui-kit` (TypeScript), or
`Sitrep.Contract` (C#). **All of these are MIT.** Nothing about them constrains your own licence —
release your Uplink under MIT, Apache-2.0, GPL, CC-BY-NC-SA, or all-rights-reserved as you please.
MIT's only condition is that you retain the copyright/permission notice.

This is deliberate. An extension surface that forces a licence on its extensions isn't an extension
surface, and roughly 12% of the KSP ecosystem ships all-rights-reserved — those authors should be
able to write an Uplink too.

## The exceptions

| Component | Licence | Why |
|---|---|---|
| `mod/Gonogo.Kos` (+ `.Tests`, + `@ksp-gonogo/kos`) | GPL-3.0-only | **Permanent.** Compile-time links kOS (`kOS.dll` / `kOS.Safe.dll`), which is GPL-3.0-only. |
| `mod/GonogoScansatUplink` (+ `@ksp-gonogo/scansat`) | GPL-3.0-only | **Provisional — on hold.** See below. |
| Everything else | MIT | Nothing else links anything copyleft. |

Both exceptions are **dependency leaves** — nothing in the repository references either one — so
their copyleft propagates nowhere. A GPL work linking MIT works is fine and imposes nothing on
those MIT works. Each ships as its own CKAN package in its own GameData folder.

The full GPLv3 text is at `LICENSE-GPL-3.0.txt`, and beside each GPL component as its own `LICENSE`.

### GonogoKos (permanent)

kOS is GPL-3.0 and we link it directly, in-process, against its public API. There is no version of
this that isn't copyleft short of dropping the integration. Users of `GonogoKos` have already
installed kOS, so they have already opted into a GPL mod. See `mod/Gonogo.Kos/NOTICE-KOS.txt`.

### GonogoScansatUplink (provisional — do not "finish the job")

SCANsat's licensing contradicts itself: its repository `LICENSE.txt` is 3-clause BSD (permissive,
which would allow MIT here), but its published CKAN metadata declares `restricted` (CKAN's
all-rights-reserved bucket). We compile-time link `SCANsat.dll`, so which one governs is
load-bearing rather than academic.

**The question is out with the SCANsat stewards (https://github.com/KSPModStewards/SCANsat).**
Until they answer, this uplink and its co-located TypeScript client stay GPL-3.0-only. That is the
conservative option and it costs nothing — like `GonogoKos` it is a leaf.

Do not relicense it to MIT on the strength of the BSD text alone. If the `restricted` tag turns out
to govern, the problem is bigger than a licence field, because we link the DLL. Full rationale in
`mod/GonogoScansatUplink/NOTICE-SCANSAT.txt`.

## The kerbcast caveat — read this before relying on the SPA's MIT

**gonogo's own source is MIT. The *built SPA bundle* is not currently MIT-usable as a whole.**

`@ksp-gonogo/app` depends (via `@ksp-gonogo/kerbcast-feed`) on `@ksp-gonogo/kerbcast` and
`@ksp-gonogo/kerbcast-react` — the camera client SDKs from the sibling kerbcast repo — which are
currently **CC-BY-NC-SA-4.0**. Those SDKs are bundled into the shipped artifact, not merely
aggregated alongside it. So the deployed SPA carries a NonCommercial restriction that gonogo's own
MIT licence does not describe.

To be precise about what MIT does and does not fix here:

- **What it fixes.** Distributing that same bundle under **GPL-3.0-only** — as gonogo did until
  now — was an actual licence violation, not just an inaccuracy: GPLv3 §7 and §10 forbid imposing
  further restrictions downstream, and NonCommercial is exactly such a restriction. MIT has no
  reciprocity clause and no "no further restrictions" clause, so MIT + an NC dependency breaks no
  licence text. The violation is gone.
- **What it does not fix.** The bundle still contains NC code. A recipient reading "MIT" would
  reasonably conclude they may use the artifact commercially, and for the bundle as a whole that is
  **false** until the kerbcast SDKs are relicensed. MIT on `@ksp-gonogo/app` is an accurate
  statement about gonogo's own code and an incomplete one about the artifact.

So: MIT is a genuine improvement over the status quo (violation → disclosure gap), not merely a
lateral move — but it is not the fix. **The fix is relicensing the kerbcast client SDKs to MIT in
`~/personal/kerbcam/` and consuming the new versions here.** They are the wire-protocol client
half — the exact structural analogue of `sitrep-sdk`, which is already MIT for this reason. The
kerbcast KSP plugin itself can stay CC-BY-NC-SA-4.0; the SPA doesn't link it, it speaks WebRTC to it.

Until that lands, this caveat is the disclosure. Don't delete it early.

## For third-party code we don't own

`kOS`, `SCANsat`, `RealAntennas`, `Telemachus`, and the vendored `Fleck` source
(`mod/Sitrep.Transport/Vendor/Fleck/LICENSE`) are not ours to relicense. Their notices live in
`THIRD-PARTY-NOTICES.md` and the per-component `NOTICE-*.txt` files, and must be retained. No
third-party assemblies are bundled — every reference is `Private="false"` and supplied by the
user's own install.

## An invariant worth knowing

**MIT → GPL is one-way.** `GonogoKos` may link the MIT `Sitrep.*` assemblies. The reverse — an
MIT assembly referencing `GonogoKos` — would be a violation. Nothing does this today, because
`GonogoKos` is a leaf. It is a mistake a future change could make silently, so if you find yourself
adding a reference *to* `Gonogo.Kos` from anywhere, stop.

## CKAN vs SPDX — a mechanical trap

`package.json` and `.csproj` use **SPDX** identifiers (`GPL-3.0-only`, `MIT`).

`.netkan` files use CKAN's **`license` enum**, which is Debian shortnames validated against
`CKAN.schema` — **there is no `-only` or `-or-later` variant**. The correct value there is
`GPL-3.0`, not `GPL-3.0-only`; a netkan declaring the latter is rejected at indexing.

Do not let the two vocabularies drift into each other.
