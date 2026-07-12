# Cross-language golden fixtures

M5 (the Sitrep C# mod) ports pure TS logic — semver gating today, then
`Clock`/`StubNetwork`/`Archive`/`Courier` and the kernel resolver — into
`mod/Sitrep.Core`. Every ported piece is checked against the **same JSON
fixture** from both sides, so drift between the reference and the port is
caught by `dotnet test`, not discovered later in a live KSP session.

## The loop

```
TS reference (mod/sitrep-kernel, mod/sitrep-server)
        │  gen script imports the REAL functions, runs them over a
        │  fixed set of input cases, writes the TS-computed results
        ▼
mod/golden-fixtures/<name>.json          (committed — the shared contract)
        │  Sitrep.Core.Tests loads the same file, calls the C# port
        │  with each vector's args, asserts the result equals `expected`
        ▼
dotnet test                               (green ⇒ ports agree; red ⇒ drift)
```

Expected values are **never hand-authored** — they come from actually
running the TS functions. That's the whole point: the fixture is generated,
not written, so a future TS change that shifts behavior regenerates the
fixture and the C# side's test will fail until the port catches up (or
the TS change is confirmed intentional and the fixture is regenerated and
committed alongside it).

## `version.json` (the first fixture)

Generated from `mod/sitrep-kernel/src/version.ts`'s three pure functions —
`compareVersions`, `satisfiesKernel`, `satisfiesModRange` — by
`mod/golden-fixtures/gen/version.gen.ts`. Regenerate with:

```
pnpm --filter @ksp-gonogo/sitrep-kernel gen:golden-fixtures
```

Each vector is `{ fn, args, expected }`. `fn` selects which function the
test calls; `args` is the exact positional argument tuple (JSON `null`
stands in for a TS `undefined`, since JSON has no `undefined`); `expected`
is what the TS function actually returned for those args. Cases cover the
tricky corners: numeric-not-lexical comparison (`"1.2"` < `"1.10"` even
though it's lexically the other way), inclusive-min/exclusive-max range
boundaries, short-form versions (`"1.2"` == `"1.2.0"`), and every
undefined-input branch (`minKernelVersion`, `range`, `modVersion`).

The C# side (`mod/Sitrep.Core.Tests/VersionGoldenFixtureTests.cs`) loads
the file at test-run time via `System.Text.Json`, switches on `fn`, and
asserts `Sitrep.Core.Semver`'s equivalent method reproduces `expected`.

## Adding a fixture for the next ported piece

1. Write a `<name>.gen.ts` script next to `version.gen.ts` that imports the
   real TS module, runs it over representative + boundary cases, and writes
   `mod/golden-fixtures/<name>.json`. Wire it into the owning package's
   `package.json` as a `gen:golden-fixtures`-style script (or extend the
   existing one) and commit the generated JSON.
2. Port the logic into `Sitrep.Core` under a matching C# type.
3. Add a `dotnet test` in `Sitrep.Core.Tests` that loads `<name>.json` and
   asserts conformance, following `VersionGoldenFixtureTests.cs`'s shape.
4. `dotnet test` green = the port is verified — no KSP session required.

Only regenerate a fixture when the TS reference intentionally changes
behavior. If `dotnet test` goes red after a fixture regen, that's real
drift in the C# port to fix, not the fixture to blindly re-copy.

## `clock.json` (scripted-scenario fixtures)

`ManualClock` (`mod/sitrep-server/src/clock.ts`) is stateful, so its fixture
isn't a `{args, expected}` vector like `version.json` — it's a **scripted
scenario**: a sequence of ops against one clock instance, plus the OBSERVABLE
OUTPUT that instance actually produced. Callbacks are represented by string
ids (not real closures) so a scenario round-trips through JSON:

```json
{
  "name": "reentrant-future-due-drains-in-order",
  "startUt": 0,
  "ops": [
    { "op": "schedule", "id": "three", "atUt": 3,
      "onFire": [{ "op": "schedule", "id": "eight", "atUt": 8 }] },
    { "op": "advanceTo", "ut": 10 }
  ],
  "expected": { "fired": ["three", "eight"], "nowAfter": 10 }
}
```

Three op kinds: `schedule` (with an optional nested `onFire` list — further
schedules issued re-entrantly, against the same clock, when this callback
fires; this is how the re-entrancy-safe-drain cases are expressed without a
real JS closure), `advanceTo`, and `cancel` (by a previous `schedule` op's
id). `expected.fired` is the actual order the TS `ManualClock` fired
callbacks in; `expected.nowAfter` is its `now()` after all ops run — both
recorded by `mod/golden-fixtures/gen/clock.gen.ts` actually executing the
scenario against the real class, never hand-typed.

Scenarios cover: ascending-atUt ordering, the inclusive `atUt <= ut`
boundary, a not-yet-due callback surviving to a later `advanceTo`, `cancel`
before due, the strict `ut < currentUt` backward guard (a `<=` typo there
regresses `repeat-advance-to-same-ut-still-fires-new-schedule` immediately),
same-UT and future-but-still-due re-entrant scheduling, repeat-`advanceTo`-
to-the-same-UT still firing a freshly scheduled callback, and a
multi-level re-entrant drain interleaved with an already-pending callback at
a tied `atUt`.

Regenerate with `pnpm --filter @ksp-gonogo/sitrep-server gen:golden-fixtures`.
The C# side (`mod/Sitrep.Core.Tests/ClockGoldenFixtureTests.cs`) replays each
scenario's ops against `Sitrep.Core.ManualClock` and asserts the fired order
and final `Now()` match.

## `stub-network.json` (inline-query scripted scenarios)

`StubNetwork` (`mod/sitrep-server/src/stub-network.ts`) is also stateful, but
unlike `ManualClock` there's no global "observable output" to record at the
end — every `delayTo` / `reachable` call is its own independent observation,
and ordering relative to mutations (e.g. a query before and after a
`setScale`) matters. So each scenario's `ops` list interleaves mutations
(`setDelay` / `setReachable` / `setScale`) with **queries**
(`queryDelay` / `queryReachable`), and every query op carries an `expected`
field filled in with whatever the real TS instance returned when the
generator reached that op:

```json
{
  "name": "set-scale-can-be-changed-again-after-being-set",
  "defaults": { "delay": 100 },
  "ops": [
    { "op": "setScale", "scale": 0 },
    { "op": "queryDelay", "vantage": "KSC", "node": "v1", "expected": 0 },
    { "op": "setScale", "scale": 1 },
    { "op": "queryDelay", "vantage": "KSC", "node": "v1", "expected": 100 }
  ]
}
```

A scenario may also carry top-level `defaults` (the constructor's
`{ delay?, reachable? }` arg) and `scale` (the constructor's scale arg,
default 1) — both omitted when the scenario relies on `StubNetwork`'s own
defaults.

Scenarios cover: default delay-0/reachable-true for any unset pair,
constructor-supplied defaults, per-pair isolation of `setDelay` and
`setReachable` (same vantage/different node, same node/different vantage),
delay and reachable as independent axes on the same pair, re-setting a pair
overwriting its previous value, the collision-safe-keying case (`("ab",
"c")` vs `("a", "bc")` never collide because pairs are keyed with a nested
map, not string concatenation), `scale`'s default-1/unscaled behavior,
`setScale` multiplying both default and pinned delays, `setScale(0)`
collapsing every delay to zero, scale never touching `reachable`, the
constructor's `scale` argument, `setScale` being changeable more than once,
and negative-scale clamping to 0 from both `setScale` and the constructor.

Regenerate with `pnpm --filter @ksp-gonogo/sitrep-server gen:golden-fixtures`
(the same script also regenerates `clock.json`). The C# side
(`mod/Sitrep.Core.Tests/StubNetworkGoldenFixtureTests.cs`) constructs a
`Sitrep.Core.StubNetwork` with the scenario's `defaults`/`scale`, replays
each op in order, and asserts every query op's `expected` matches what the
port returns at that point.

## `archive.json` (inline-query scripted scenarios)

`Archive` (`mod/sitrep-server/src/archive.ts`) covers its READ behavior only
— `record` / `readAtVantage` — the same inline-query shape as
`stub-network.json`: each scenario's `ops` list interleaves mutations
(`record`) with queries (`readAtVantage`), and every `readAtVantage` op
carries an `expected` field — either `{ value, validAt }` or `null` (JSON has
no `undefined`) — filled in with whatever the real TS instance returned when
the generator reached that op, so ordering across successive reads (critical
for freeze-on-recession) is preserved exactly:

```json
{
  "name": "freeze-on-recession",
  "ops": [
    { "op": "record", "topic": "v.altitude", "value": 400, "validAtUt": 3 },
    { "op": "readAtVantage", "topic": "v.altitude", "vantage": "v1",
      "delaySeconds": 2, "nowUt": 5, "expected": { "value": 400, "validAt": 3 } },
    { "op": "readAtVantage", "topic": "v.altitude", "vantage": "v1",
      "delaySeconds": 4, "nowUt": 6, "expected": { "value": 400, "validAt": 3 } }
  ]
}
```

Scenarios cover: the basic read (`sceneUt = nowUt - delaySeconds`, latest
sample with `validAt <= scene`), two vantages reading the same archive at
independent delay offsets with independent cursors, freeze-on-recession (a
vantage's delay growing faster than time advances holds its scene rather
than rewinding, across three successive reads), a clamped scene before the
first recorded sample (`null`), reading a topic with no recorded samples at
all (`null`), an out-of-order `record` call inserted to keep the per-topic
list ascending by `validAt` (and a subsequent read seeing it in the right
position), and collision-safe cursor keying (`(topic, vantage)` via a nested
map, not string concatenation).

Regenerate with `pnpm --filter @ksp-gonogo/sitrep-server gen:golden-fixtures`
(the same script also regenerates `clock.json` and `stub-network.json`). The
C# side (`mod/Sitrep.Core.Tests/ArchiveGoldenFixtureTests.cs`) constructs a
`Sitrep.Core.Archive`, replays each op in order, and asserts every
`readAtVantage` op's `expected` matches what the port returns at that point.

**Not covered here:** `Archive.Snapshot()` / `Archive.Restore()` are a
C#-only addition (no TS reference) for M5b quicksave — serializing full
archive state, including per-(topic, vantage) cursor positions, so a delayed
archive survives save/load. That round trip is tested directly against the
C# port in `mod/Sitrep.Core.Tests/ArchiveSnapshotRestoreTests.cs`, with no
golden fixture, since there's no TS behavior to conform to.

## `courier.json` (scripted-scenario fixtures)

`Courier` (`mod/sitrep-server/src/courier.ts`) ties together `Clock`,
`Network` (`StubNetwork`), and `Archive` into the reference delay engine for
both TELEMETRY (streams) and COMMANDS (round-trip request/response). Unlike
the other stateful fixtures, `Courier`'s observations are *asynchronous*: a
stream subscriber or command-response callback can fire synchronously
(subscribe-time catch-up) or later, when a scheduled Clock callback drains
during `advanceTo`. So a scenario's `ops` list (`record`, `subscribeStream`,
`unsubscribeStream`, `setCommandHandler`, `dispatchCommand`, `advanceTo`) is
run against one real `Courier`, and EVERY callback invocation — in the exact
order it actually fired — is appended to a single `expected.events` log:

```json
{
  "name": "delivers-at-valid-at-plus-delay",
  "network": { "setDelay": [{ "vantage": "KSC", "node": "vessel", "seconds": 2 }] },
  "ops": [
    { "op": "subscribeStream", "id": "s1", "node": "vessel", "topic": "alt", "vantage": "KSC" },
    { "op": "record", "node": "vessel", "topic": "alt", "value": 100, "validAtUt": 0 },
    { "op": "advanceTo", "ut": 2 }
  ],
  "expected": {
    "events": [
      { "kind": "stream", "subscribeId": "s1", "topic": "alt", "payload": 100,
        "source": "vessel", "vantage": "KSC", "validAt": 0, "deliveredAt": 2, "seq": 1 }
    ]
  }
}
```

A scenario may carry a top-level `network` config (`setDelay` /
`setReachable` entries, plus optional `defaults` / `scale` mirroring
`StubNetwork`'s constructor). `setCommandHandler` always installs the same
fixed, deterministic handler (`command => ({ ok: command, args, node })`),
so command scenarios stay JSON-fixture-free. Each event in the log is
tagged `kind: "stream"` (with `subscribeId`, `topic`, `payload`) or
`kind: "command"` (with `requestId`, `result`), plus the shared `Meta`
fields every delivery carries: `source`, `vantage`, `validAt`,
`deliveredAt`, and a per-courier monotonically increasing `seq`.

Scenarios cover: delayed delivery at `validAt + delay`, two vantages
receiving the same sample independently (no duplicate delivery to the
nearer one), a subscriber joining mid-transit (in-flight scheduling, not a
miss), a subscriber joining after arrival (synchronous catch-up),
unsubscribe removing a subscriber before its scheduled delivery fires, a
single large `advanceTo` draining several deliveries in one batch — each
reporting its OWN captured fire-UT, not a shared re-read of `clock.now()`
— a command's execute-at-uplink/confirm-at-uplink+downlink round trip
(including args flowing through to the result), and a command dispatched
to an unreachable node dropped with honest silence (no execute, no
response, ever).

Regenerate with `pnpm --filter @ksp-gonogo/sitrep-server gen:golden-fixtures`
(the same script also regenerates `clock.json`, `stub-network.json`, and
`archive.json`). The C# side
(`mod/Sitrep.Core.Tests/CourierGoldenFixtureTests.cs`) constructs a
`Sitrep.Core.Courier`, replays each op in order, and asserts the resulting
event log — kind, topic/requestId, payload/result, and every `Meta` field
— matches the recorded TS-observed log exactly, in order.

**Not covered here:** `Courier.SnapshotCommands()` / `Courier.RestoreCommands()`
are a C#-only addition (no TS reference) for M5b quicksave, scoped to the
IN-FLIGHT COMMAND QUEUE only — the archive is persisted separately
(`Archive.Snapshot`/`Restore` above), and telemetry subscriptions plus
their scheduled deliveries are runtime/derivable state that a reconnecting
client re-establishes by re-subscribing, not something the Courier
persists. That round trip (dispatch, snapshot mid-flight, restore onto a
fresh `Courier`/`Clock`, confirm at the original UTs) is tested directly
against the C# port in
`mod/Sitrep.Core.Tests/CourierCommandQueueSnapshotRestoreTests.cs`, with no
golden fixture, since there's no TS behavior to conform to.
