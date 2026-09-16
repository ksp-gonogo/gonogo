# KspGonogo.Sitrep.Contract

The C# half of the [Gonogo](https://ksp-gonogo.github.io/gonogo/) Uplink surface: the
attributes, descriptors and payload types a Kerbal Space Program mod implements to publish
telemetry into a Gonogo dashboard, plus the version stamp that decides whether the host will
load your Uplink at all.

Start at the **[Uplink developer documentation](https://ksp-gonogo.github.io/uplink-dev-docs/)**.
The TypeScript half of the same contract ships as
[`@ksp-gonogo/sitrep-sdk`](https://www.npmjs.com/package/@ksp-gonogo/sitrep-sdk), generated from
these same types, so a channel declared here and a widget reading it cannot disagree about its
shape.

## Target frameworks

| framework | what you get | dependencies |
| --- | --- | --- |
| `net472`, `netstandard2.0` | `Sitrep.Contract.dll` | none |
| `net10.0` | `Sitrep.Contract.dll` and `Sitrep.Contract.TestSupport.dll` | `xunit.assert` |

An Uplink plugin builds against `net48` (what KSP runs) and therefore resolves the `net472`
assets: no test framework comes with it, and nothing but the contract lands in `GameData`. A
`net10.0` test project resolves the `net10.0` assets and additionally gets `TestSupport`, the
shared conformance assertions the bundled Uplinks use on their own contract slices.

That split is deliberate and load-bearing: an assembly KSP loads must reference nothing it
cannot find beside itself, and `TestSupport` needs xunit. The two are separate assemblies for
the same reason, so a plugin never carries a metadata reference to a test framework.

## Versioning

The package version **is** the wire contract's version, `Major.Minor.0`, taken from
`ContractVersion.Major` / `ContractVersion.Minor`. There is no separate package number to
track.

- a **Major** bump is breaking: a wire-visible type lost or retyped a member, and an Uplink
  built against the old Major is refused by the host
- a **Minor** bump is additive: an Uplink built against an older Minor of the same Major still
  loads

So a `PackageReference` range expresses contract compatibility directly. `[17.0.0, 18.0.0)`
says "any additive contract on the Major 17 line".

## Licence

MIT. Your Uplink may be under any licence you like; MIT's only condition is that you retain the
copyright and permission notice.
