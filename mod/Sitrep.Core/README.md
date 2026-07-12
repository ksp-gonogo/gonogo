# Sitrep.Core

The pure, KSP-free half of the Sitrep C# mod (M5). `netstandard2.0`, and by
architectural rule **must never reference `UnityEngine` or
`Assembly-CSharp`** — that's what makes Telemachus's off-thread-game-state-read
bug structurally impossible to write here. Only `Gonogo.KSP` (not yet built)
touches Unity/KSP types.

This project currently holds:

- `Semver.cs` — a line-for-line C# port of `mod/sitrep-kernel/src/version.ts`'s
  `compareVersions` / `satisfiesKernel` / `satisfiesModRange`. It exists to
  prove the **cross-language golden-fixture loop** described in
  `mod/golden-fixtures/README.md` — the pattern the rest of the M5 port
  (StubNetwork, Archive, Courier, the kernel resolver) follows.
- `Clock.cs` — `IClock` / `ManualClock` / `RealClock`, ported from
  `mod/sitrep-server/src/clock.ts`. `ManualClock` is the first **stateful**
  port: its golden fixture (`mod/golden-fixtures/clock.json`) is a set of
  scripted scenarios (ops + the observable fired-order/`now()` a real TS
  `ManualClock` produced), not a plain `{args, expected}` vector — see the
  "`clock.json`" section of `mod/golden-fixtures/README.md` for the schema.
  `RealClock` has no TS-side fixture (nothing deterministic to assert about
  wall-clock timing); it exists only so production code has a real
  implementation to construct.
- `StubNetwork.cs` — `INetwork` / `StubNetwork`, ported from
  `mod/sitrep-server/src/stub-network.ts`. Also stateful, but with no global
  observable output to record: each scenario in
  `mod/golden-fixtures/stub-network.json` interleaves mutations (`setDelay` /
  `setReachable` / `setScale`) with queries (`queryDelay` / `queryReachable`)
  that each carry their own `expected` value, so ordering relative to
  mutations (e.g. before/after a `setScale`) is preserved — see the
  "`stub-network.json`" section of `mod/golden-fixtures/README.md`.
- `Archive.cs` — `Archive`, ported from `mod/sitrep-server/src/archive.ts`.
  Its read behavior (`Record` / `ReadAtVantage` / `Samples`) is checked
  against `mod/golden-fixtures/archive.json`, same scripted-scenario shape as
  `StubNetwork`'s fixture — see the "`archive.json`" section of
  `mod/golden-fixtures/README.md`. `Archive` also carries a **C#-only**
  addition with no TS reference: `Snapshot()` / `Restore()`, which copy the
  full archive state (all samples AND all per-(topic, vantage) cursor
  positions, including a frozen/receded cursor) to and from the plain,
  BCL-only `ArchiveState` POCO — no serialization happens inside Core.
  Turning that POCO into a persisted blob (JSON or otherwise) is an **M5b**
  concern, done with the generated Contract serializers / the
  ScenarioModule, deliberately kept out of `Sitrep.Core` so this project
  stays dependency-free. It's tested directly in
  `Sitrep.Core.Tests/ArchiveSnapshotRestoreTests.cs` as an object-level
  round trip (build → `Snapshot()` → `Restore()` → assert identical
  subsequent reads), not via a golden fixture and not via JSON.

## Verifying this port

```
cd mod
dotnet test Sitrep.Core.Tests/Sitrep.Core.Tests.csproj
```

`Sitrep.Core.Tests` loads `mod/golden-fixtures/version.json`,
`mod/golden-fixtures/clock.json`, `mod/golden-fixtures/stub-network.json`,
and `mod/golden-fixtures/archive.json` — all generated from the real TS
reference, never hand-authored — and asserts the C# port reproduces them,
plus a C#-only round-trip test for `Archive.Snapshot`/`Restore`. See
`mod/golden-fixtures/README.md` for how each fixture is produced and how to
add the next one.
