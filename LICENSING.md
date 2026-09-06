# Licensing

**gonogo is MIT. The rule is mechanical: an Uplink that COMPILE-TIME LINKS a GPL or
unresolved-licence mod inherits that mod's copyleft; every other Uplink, and everything else in
this repository, is MIT. Today that catches `GonogoKosUplink` and `GonogoMechJebUplink`. If you
don't touch those, MIT is all you need to know.**

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

## The exceptions

| Component | Licence | Why |
|---|---|---|
| `mod/GonogoKosUplink` (+ `.Tests`, + `@ksp-gonogo/gonogo-kos-uplink`) | GPL-3.0-only | **Permanent.** Compile-time links kOS (`kOS.dll` / `kOS.Safe.dll`), which is GPL-3.0-only. |
| `mod/GonogoMechJebUplink` (+ `.Tests`, + `@ksp-gonogo/gonogo-mechjeb-uplink`) | GPL-3.0-only | **Permanent.** Compile-time links MechJeb2 (`MechJeb2.dll`), which is GPL-3.0. |
| Everything else | MIT | Nothing else links anything copyleft. |

All three exceptions are **dependency leaves**, nothing in the repository references any of them,
so their copyleft propagates nowhere. A GPL work linking MIT works is fine and imposes nothing on
those MIT works. Each ships as its own CKAN package in its own GameData folder.

The full GPLv3 text is at `LICENSE-GPL-3.0.txt`, and beside each GPL component as its own `LICENSE`.

### GonogoKosUplink (permanent)

kOS is GPL-3.0 and we link it directly, in-process, against its public API. There is no version of
this that isn't copyleft short of dropping the integration. Users of `GonogoKosUplink` have already
installed kOS, so they have already opted into a GPL mod. See `mod/GonogoKosUplink/NOTICE-KOS.txt`.

### SCANsat: a question that left with its Uplink

`GonogoScansatUplink` has migrated to `gonogo-uplinks`, and its licensing question went with it.
Recorded here only so the question is not lost: SCANsat's repository `LICENSE.txt` is 3-clause BSD
(permissive) while its published CKAN metadata declares `restricted` (all-rights-reserved), and the
Uplink compile-time links `SCANsat.dll`, so which one governs is load-bearing rather than academic.
**The question was put to the SCANsat stewards (https://github.com/KSPModStewards/SCANsat) and had
not been answered when the Uplink left.** Until it is, that Uplink stays GPL-3.0-only, which is the
conservative option. Do not relicense it to MIT on the strength of the BSD text alone. The full
rationale travels with the Uplink, in its own NOTICE.

### GonogoMechJebUplink

MechJeb2 is GPL-3.0 and this uplink compile-time links `MechJeb2.dll`, so the assembly is
GPL-3.0-only. Same shape as the two rows above, and for the same reason: a leaf assembly, its own
CKAN package, its own GameData folder, nothing in the repository references it.

Compile-time binding is not a deviation here. `GonogoKosUplink` names types out of `kOS.Module`,
`kOS.Safe.Screen` and `kOS.UserIO` and is GPL-3.0-only by exactly the same mechanism, so the
copyleft on this one is not novel.

Reflection is what an Uplink does for a mod whose LICENCE forbids linking: it reaches the mod's
types at arm's length and stays MIT. The two Uplinks that did this here (against AGExt, GPL-3.0,
and RP-1, CC-BY-NC-SA-4.0) have since migrated to `gonogo-uplinks` and carry their own notices.
MechJeb2 is linkable, so the licence poses no question this uplink has to route around.

`MechJeb2.dll` is vendored in the private reference set alongside `kOS.dll` and `SCANsat.dll`, so
CI compiles this assembly and `publish-mods.yml` publishes it. A compile-time reference copy held
in a private build repository is not distribution and adds no obligation. Reasoning and evidence in
`local_docs/design/mechjeb-provider-and-vendoring.md`; the linkage notice is
`mod/GonogoMechJebUplink/NOTICE-MECHJEB.txt`.

What the three GPL-3.0-only rows DO owe on every release is the licence text travelling with the
work, and each ships as its own standalone CKAN package, so each zip is the work. Each project
directory holds the full GPLv3 and `_build-uplink-mod.yml` bundles it into the zip beside the
NOTICE.

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

**MIT → GPL is one-way.** `GonogoKosUplink` may link the MIT `Sitrep.*` assemblies. The reverse (an
MIT assembly referencing `GonogoKosUplink`) would be a violation. Nothing does this today, because
`GonogoKosUplink` is a leaf. It is a mistake a future change could make silently, so if you find yourself
adding a reference *to* `GonogoKosUplink` from anywhere, stop.

## CKAN vs SPDX: a mechanical trap

`package.json` and `.csproj` use **SPDX** identifiers (`GPL-3.0-only`, `MIT`).

`.netkan` files use CKAN's **`license` enum**, which is Debian shortnames validated against
`CKAN.schema`: **there is no `-only` or `-or-later` variant**. The correct value there is
`GPL-3.0`, not `GPL-3.0-only`; a netkan declaring the latter is rejected at indexing.

Do not let the two vocabularies drift into each other.
