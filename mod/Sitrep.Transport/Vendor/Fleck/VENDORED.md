# Vendored: Fleck

Source: https://github.com/statianzo/Fleck
License: MIT (see `LICENSE` in this directory)
Vendored version: tag `1.2.0`, commit `45672e0781974bb04dbad1b94320756a33c60a6d` (2021-04-21)
Vendored files: `src/Fleck/**/*.cs` from the upstream repo, unmodified except for:

1. A namespace rename (`Fleck` → `Sitrep.Vendor.Fleck`, `Fleck.Handlers` →
   `Sitrep.Vendor.Fleck.Handlers`, `Fleck.Helpers` → `Sitrep.Vendor.Fleck.Helpers`).
2. A leading `#nullable disable` pragma in every file (Fleck predates nullable
   reference types; `Sitrep.Transport` builds with `<Nullable>enable</Nullable>`,
   and without this pragma the vendored tree alone emits ~40 CS86xx warnings that
   would drown out anything real from our own code).

No other lines were touched — logic, formatting, and behavior are untouched.

## Why source, not a NuGet/DLL reference

KSP loads every DLL under `GameData/` into a single Mono AppDomain and resolves
assembly names first-registered-wins. A bundled `Fleck.dll` would collide with any
other installed mod that also bundles Fleck (or a different version of it),
non-deterministically picking one binary for both. Compiling Fleck's source directly
into `Sitrep.Transport.dll` under a private namespace avoids the collision entirely —
nothing outside this assembly can see or depend on a type named `Fleck.*`.

## Updating

To pick up a newer Fleck release: re-clone upstream at the desired tag, copy
`src/Fleck/**/*.cs` over this directory (preserving `Handlers/`, `Helpers/`,
`Interfaces/` subfolders), re-run the same namespace rename, and update the
version/commit noted above.
