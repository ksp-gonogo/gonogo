# Third-Party Notices

The gonogo/Sitrep telemetry mod integrates with several third-party KSP mods.
gonogo/Sitrep does not bundle or redistribute their binaries — these notices
cover the mods' own licenses, retained here because Sitrep's Uplink
integrations reference their data formats, wire protocols, or (in kOS's
case) link directly against their assemblies.

## kOS (KerboScript Operating System)

- **Integration:** the kOS Uplink links `kOS.Safe`/`kOS` directly to run
  Sitrep telemetry scripts on a vessel's kOS CPU (see `mod/Gonogo.Kos/`).
  This direct link is why Sitrep's core assemblies (everything except
  `Sitrep.Contract`) are licensed **GPL-3.0-only** — kOS is GPLv3-only, and
  linking a GPLv3-only work requires the combined work to be GPLv3-compatible.
- **License:** GNU General Public License v3.0 (GPLv3-only)
- **Source:** https://github.com/KSP-KOS/KOS
- Full license text: `local_docs/reference/kos/LICENSE.md` (also mirrored at
  the repository root `LICENSE`, since gonogo/Sitrep core is GPLv3-only for
  the same reason).

## SCANsat

- **Integration:** `mod/GonogoScansatUplink` (a separate `ISitrepUplink`,
  see `.superpowers/sdd/uplink-packaging-pattern.md`) references
  `SCANsat.dll`/`SCANsat.Unity.dll` at compile time (reference-only,
  `Private="false"`; not bundled) and calls SCANsat's public API in-process
  to stream `scansat.*` channels, replacing the earlier Telemachus-fork
  `scan.*` keys that gonogo's MapView / Scanning widgets consumed. It also
  replicates small public-input formulas from SCANsat's source (`getFOV`,
  `getElevation`/`getBiomeIndex` sampling conventions — see
  `local_docs/telemetry-mod/scansat-migration-spec.md` §0D/§0E). Because
  SCANsat is BSD (permissive, GPL-compatible), `GonogoScansatUplink.dll` is
  GPL-3.0-only "by inclusion" and carries this notice
  (`mod/GonogoScansatUplink/NOTICE-SCANSAT.txt`).
- **License:** 3-clause BSD (plus separately-licensed assets — see full
  notice for CC0 science text, Apache-2.0 ColorBrewer palettes, and
  CC-BY-SA-4.0 additional color schemes/contract pack, all bundled
  unmodified within SCANsat itself, not by gonogo).
- **Source:** https://github.com/S-C-A-N/SCANsat

```
Copyright (c) 2013 damny <df.ksp@erinye.com>
Copyright (c) 2014 David Grandy <david.grandy@gmail.com>
Copyright (c) 2014 technogeeky <technogeeky@gmail.com>

Redistribution and use in source and binary forms, with or without modifica-
tion, are permitted provided that the following conditions are met:

  1.  Redistributions of source code must retain the above copyright notice,
      this list of conditions and the following disclaimer.

  2.  Redistributions in binary form must reproduce the above copyright
      notice, this list of conditions and the following disclaimer in the
      documentation and/or other materials provided with the distribution.

  3.  The name of the author may not be used to endorse or promote products
      derived from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE AUTHOR ``AS IS'' AND ANY EXPRESS OR IMPLIED
WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MER-
CHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED.  IN NO
EVENT SHALL THE AUTHOR BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPE-
CIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS;
OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY,
WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTH-
ERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED
OF THE POSSIBILITY OF SUCH DAMAGE.
```

Full upstream notice (including asset-specific licenses and bundled
third-party library notices): `local_docs/reference/scansat/LICENSE.txt`.

## RealAntennas

- **Integration:** treated as a first-class comms provider alongside
  RemoteTech in Sitrep's comms/delay model (see
  `local_docs/telemetry-mod/spec-streaming-delay-model.md` and
  `project_new_mod_comms_remotetech` design notes) — Sitrep reads
  RealAntennas' link/delay state to drive signal-loss and light-delay
  telemetry. No RealAntennas code is linked into gonogo or Sitrep.
- **License:** Creative Commons Attribution-ShareAlike 4.0 International
  (CC-BY-SA-4.0)
- **Source:** https://github.com/JonnyOThan/RealAntennas
- **Attribution:** RealAntennas by Zephram Stark / the RealAntennas
  contributors, licensed CC-BY-SA-4.0. See
  https://creativecommons.org/licenses/by-sa/4.0/ for the full license text.

---

## Dependency license audit (workspace scan)

A scan of `package.json` (npm workspaces) and the `mod/*.csproj` files
(NuGet) for GPL-incompatible licenses on 2026-07-08 found **no incompatible
dependencies**. All npm dependencies use permissive licenses (MIT/ISC/BSD/
Apache-2.0-family), which are GPLv3-compatible. The only non-BCL NuGet
dependency, `Reinforced.Typings` (MIT, compile-time-only codegen tool scoped
to `Sitrep.Contract`'s netstandard2.0 build via `PrivateAssets="all"`), does
not flow into any GPL-licensed assembly at runtime.

Because `Sitrep.Contract` (and its generated TypeScript counterpart,
`@ksp-gonogo/sitrep-sdk`) is licensed **MIT** rather than GPL-3.0-only,
third-party Uplinks that reference the contract are not constrained by
core's GPL license at all — they only need to comply with MIT's terms
(retain the copyright/permission notice), regardless of the Uplink's own
license (GPLv2, proprietary, etc.).
