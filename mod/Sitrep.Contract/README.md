# KspGonogo.Sitrep.Contract

The C# half of the [Gonogo](https://github.com/ksp-gonogo/gonogo) Uplink surface: the
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
| `net10.0` | `Sitrep.Contract.dll`, `Sitrep.Contract.TestSupport.dll` and `Sitrep.Core.dll` | `xunit.assert` |

An Uplink plugin builds against `net48` (what KSP runs) and therefore resolves the `net472`
assets: no test framework comes with it, and nothing but the contract lands in `GameData`. A
`net10.0` test project resolves the `net10.0` assets and additionally gets `TestSupport`, the
shared conformance assertions the bundled Uplinks use on their own contract slices, and
`Sitrep.Core`, the delay engine itself for a test that wants the real `Courier`/`Archive` path
end to end rather than a double of it.

That split is deliberate and load-bearing: an assembly KSP loads must reference nothing it
cannot find beside itself, `TestSupport` needs xunit, and `Sitrep.Core` is already in
`GameData` where a second copy would shadow the one Gonogo loaded. So a plugin never carries a
metadata reference to a test framework and never ships its own core.

`Sitrep.Core` is not part of the wire contract and carries no compatibility promise: it moves
with the app, not with the contract version below. A core change that breaks your test is
showing you Uplink work rather than reporting a broken package.

## Versioning

Two numbers, and they answer different questions.

- **The package version is the Gonogo release** it shipped with. Every published Gonogo package
  carries the same one: this package, and `@ksp-gonogo/sitrep-sdk`, `@ksp-gonogo/ui-kit` and
  `@ksp-gonogo/uplink-tools` on npm. Reference the release you build against, and move them
  together. A release candidate is that release's version with an `-rc.<n>` suffix
- **The wire contract version** is what the host checks when it loads your Uplink. It is
  `ContractVersion.Major` and `ContractVersion.Minor` in this assembly, and is also stamped on
  it as the `SitrepContractVersion` assembly metadata. A Major bump is breaking: a wire-visible
  type lost or retyped a member, and the host refuses an Uplink built against an older Major. A
  Minor bump is additive: an Uplink built against an older Minor of the same Major still loads

So a newer Gonogo release does not by itself mean your Uplink stops loading: only a contract
Major does. The release notes on each version name the contract it speaks.

## Licence

MIT. Your Uplink may be under any licence you like; MIT's only condition is that you retain the
copyright and permission notice.
