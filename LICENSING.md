# Licensing

**gonogo is MIT. The rule is mechanical: an Uplink that COMPILE-TIME LINKS a GPL or
unresolved-licence mod inherits that mod's copyleft; every other Uplink, and everything else in
this repository, is MIT. If you are not writing an Uplink that links a copyleft mod, MIT is all
you need to know.**

Uplinks are migrating out of this repository into `gonogo-uplinks`, so treat the names below as
examples of the rule rather than a register to maintain: when an Uplink leaves, its obligation
leaves with it, and the mechanism above is what still decides the answer.

That's the whole rule. The rest of this file is the detail behind it.

## Writing an Uplink or a widget

You need `@ksp-gonogo/sitrep-sdk`, `@ksp-gonogo/core`, and `@ksp-gonogo/ui-kit` (TypeScript), or
`Sitrep.Contract` (C#). **All of these are MIT.** Nothing about them constrains your own licence,
release your Uplink under MIT, Apache-2.0, GPL, CC-BY-NC-SA, or all-rights-reserved as you please.
MIT's only condition is that you retain the copyright/permission notice.

This is deliberate. An extension surface that forces a licence on its extensions isn't an extension
surface, and roughly 12% of the KSP ecosystem ships all-rights-reserved, those authors should be
able to write an Uplink too.

## The exception, stated as a rule

| Component | Licence | Why |
|---|---|---|
| An Uplink that COMPILE-TIME LINKS a copyleft mod | that mod's licence | Linking binds you to it. The Uplink is a leaf: its own assembly, its own CKAN package, its own GameData folder, and nothing in this repository references it. |
| An Uplink that REFLECTS against a mod | MIT | Reflection reaches the mod's types at arm's length, which is what to do when a mod's licence forbids linking. |
| Everything else | MIT | Nothing else links anything copyleft. |

**No Uplink is named here on purpose.** Uplinks are migrating out of this repository into
`gonogo-uplinks`, and a licence obligation travels with the code that incurs it: when an Uplink
leaves, its obligation leaves too, and its own NOTICE is where the detail belongs. A register of
names in this file would go stale on every migration and tell a reader something false. The
mechanism above does not go stale.

So the question to ask about any Uplink is only: **does it link, or does it reflect?** If it
links something copyleft, that Uplink's assembly and its co-located client take the mod's licence,
and it needs a NOTICE of its own saying so. Otherwise it is MIT like the rest of the repository.

## The kerbcast caveat: read this before relying on the SPA's MIT

**gonogo's own source is MIT. A build that carries the kerbcast Uplink's client is not
MIT-usable as a whole.**

The kerbcast Uplink client depends on `@ksp-gonogo/kerbcast` and `@ksp-gonogo/kerbcast-react`:
the camera client SDKs from the sibling kerbcast repo, which are currently
**CC-BY-NC-SA-4.0**. They are bundled into that client, not merely aggregated alongside it, so
any artifact carrying it carries a NonCommercial restriction that gonogo's own MIT licence does
not describe.

**Since the kerbcast Uplink left this repo, the SPA bundle no longer contains that code**: the
Uplink lives in its own repository, its client is fetched at runtime from the URL its mod
publishes, and an operator who never installs it never receives an NC byte. The caveat is
therefore about the INSTALLED combination rather than about what this repo ships, and it stays
because the combination is the normal one for anyone running cameras.

To be precise about what MIT does and does not fix here:

- **What it fixes.** Distributing that same bundle under **GPL-3.0-only** (as gonogo did until
  now) was an actual licence violation, not just an inaccuracy: GPLv3 §7 and §10 forbid imposing
  further restrictions downstream, and NonCommercial is exactly such a restriction. MIT has no
  reciprocity clause and no "no further restrictions" clause, so MIT + an NC dependency breaks no
  licence text. The violation is gone.
- **What it does not fix.** A running install that loaded the kerbcast Uplink still holds NC
  code. An operator reading "MIT" would reasonably conclude they may use the whole of what is in
  front of them commercially, and that stays **false** until the kerbcast SDKs are relicensed.

So: MIT is a genuine improvement over the status quo (violation → disclosure gap), not merely a
lateral move: but it is not the fix. **The fix is relicensing the kerbcast client SDKs to MIT**
and consuming the new versions in the Uplink. They are the wire-protocol client
half: the exact structural analogue of `sitrep-sdk`, which is already MIT for this reason. The
kerbcast KSP plugin itself can stay CC-BY-NC-SA-4.0; the SPA doesn't link it, it speaks WebRTC to it.

Until that lands, this caveat is the disclosure. Don't delete it early.

## For third-party code we don't own

`kOS`, `SCANsat`, `RealAntennas`, and the vendored `Fleck` source
(`mod/Sitrep.Transport/Vendor/Fleck/LICENSE`) are not ours to relicense. Their notices live in
`THIRD-PARTY-NOTICES.md` and the per-component `NOTICE-*.txt` files, and must be retained. No
third-party assemblies are bundled, every reference is `Private="false"` and supplied by the
user's own install.

## An invariant worth knowing

**MIT → GPL is one-way.** A copyleft Uplink may link the MIT `Sitrep.*` assemblies. The reverse, an
MIT assembly referencing a copyleft Uplink, would be a violation. Nothing does this today, because
every Uplink is a leaf. It is a mistake a future change could make silently, so if you find yourself
adding a reference *to* a copyleft Uplink from anywhere, stop.

## CKAN vs SPDX: a mechanical trap

`package.json` and `.csproj` use **SPDX** identifiers (`GPL-3.0-only`, `MIT`).

`.netkan` files use CKAN's **`license` enum**, which is Debian shortnames validated against
`CKAN.schema`: **there is no `-only` or `-or-later` variant**. The correct value there is
`GPL-3.0`, not `GPL-3.0-only`; a netkan declaring the latter is rejected at indexing.

Do not let the two vocabularies drift into each other.
