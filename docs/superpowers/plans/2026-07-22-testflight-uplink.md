# GonogoTestFlightUplink Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `GonogoTestFlightUplink` — a reflection-only C# Sitrep uplink that makes TestFlight the RO/RP-1 engine-reliability authority, publishing the Domain-neutral `reliability.summary` + `reliability.parts` Topics through the Kernel `reliability` capability at a HIGHER specificity than `KerbalismUplink`, so under RP-1 (where Kerbalism `Features.Reliability = false`) TestFlight's live per-engine data wins with no client choice.

**Architecture:** TestFlight and Kerbalism-Reliability both feed ONE reliability concept. Rather than two competing Domain topics (which would force a client choice, forbidden by the design), reliability is a **Kernel capability** modelled on the existing `comms` capability (see `mod/GonogoRealAntennasUplink/RealAntennasUplink.cs:104-110` + `mod/Gonogo.KSP/CommsCoreUplink.cs`): each uplink registers an `IReliabilityProvider` with a specificity rank, the Kernel elects the most-specific live one, and the elected provider's data is published on `reliability.*`. `TestFlightUplink` registers specificity 10 (engine-authoritative); `KerbalismUplink` registers specificity 1 (`unmodeled` fallback — see `2026-07-22-kerbalism-uplink.md` Task 6). Under RO only TestFlight is live; in stock Kerbalism only Kerbalism is live; the pathological both-on case resolves by specificity in the Kernel. Zero compile-time link to TestFlight — all reads go through a `TestFlightReflection` helper mirroring `RaReflection.cs`. **No dedicated client widget:** reliability is rendered by the FleetRoster `line-updates` slot (a separate widget spec, exactly as `comms.*` is rendered by the core FleetComms widget, not by the RealAntennas uplink).

**Tech Stack:** C# net48 (mod) / net10.0 (mod tests, xunit); reflection over `TestFlightCore.dll` / `TestFlightAPI.dll` (`GameData/TestFlight/Plugins/`).

## Global Constraints

- Work ONLY in your own worktree on a NEW branch off **staging**; verify `git branch --show-current` before starting
- Commit locally, NEVER push; author as a human (no AI attribution trailer, no trailing periods on bullets, no em-dashes)
- Pre-commit runs biome + cross-package typecheck; if it fails, read + fix, re-commit; NEVER `--no-verify`
- Vocabulary: **Domain** / **Topic** / **Value**; say "Topic" not "channel"
- No Uplink talks to another; reliability coordination is ONLY via the Kernel capability election, never one uplink reading another's settings or topics
- Reflection-only: MIT license expression on the mod project; no `TestFlight*.dll` compile reference
- `Health()` mandatory; report `Unavailable("TestFlight assembly not loaded")` when absent
- Presence-gate the Domain with `testflight.available` (`DelayRole.TrueNow`, bare boolean); vessel telemetry is `DelayRole.Delayed`
- **RO/RP-1 is NOT captured on the Deck as of 2026-07-22** (`local_docs/ro-fixtures/` is empty; the RO install is a bigger lift per the DECISIONS doc). Therefore **every TestFlight symbol signature in this plan is source-confidence and tagged [verify]** — resolve each against a live Deck RP-1 smoke test (or an `ilspycmd` dump of `TestFlightCore.dll`/`TestFlightAPI.dll`) before locking, exactly as the DECISIONS "Still-VERIFY" list requires. Build the reflection shell + capability wiring now; confirm the exact member names during the RO fixture-capture pass
- Design reference (read by absolute path): `/Users/jon.pepler/personal/gonogo/local_docs/kerbalism-RO-design-DECISIONS.md` (§Reliability authority), `/Users/jon.pepler/personal/gonogo/local_docs/kerbalism-design-research-round2.md` (§1e reliability findings)

---

## Reference: the reliability contract (from the research)

- `rel_ignitions` / `rel_duration` (Kerbalism) are fractions CONSUMED (1.0 = spent); the shared `ReliabilityPartEntry` uses `IgnitionsConsumed`/`DurationConsumed`, and pre-burn "remaining" = `1 - value`. TestFlight's per-engine data maps onto the SAME `ReliabilityPartEntry` shape so the FleetRoster renderer is source-agnostic.
- TestFlight per-engine concepts **[verify]** (from `GameData/RealismOverhaul/TestFlight_Generic_Engines.cfg` + TestFlight docs): `ratedBurnTime`, `ratedContinuousBurnTime`, `testedBurnTime` (config); runtime `ITestFlightCore` on each engine part module exposes current reliability (0..1), current flight data (data units "du"), and momentary failure rate. The engine "flight data" accumulates with use and drives the reliability curve.
- The shared wire POCOs `ReliabilitySummary` + `ReliabilityPartEntry` and the capability interface `IReliabilityProvider` are DEFINED in `2026-07-22-kerbalism-uplink.md` Tasks 1 + 6. This plan CONSUMES them — build the Kerbalism spec's contract tasks first, or land them together.

## File Structure

- `mod/GonogoTestFlightUplink/GonogoTestFlightUplink.csproj` (net48, MIT, reflection-only)
- `mod/GonogoTestFlightUplink/TestFlightReflection.cs` — presence probe + cached handles + per-engine reads (KSP-referencing shell)
- `mod/GonogoTestFlightUplink/TestFlightReliabilityProvider.cs` — pure-ish `IReliabilityProvider` impl mapping engine reads → the shared POCO dicts
- `mod/GonogoTestFlightUplink/TestFlightUplink.cs` — the `[SitrepUplink("testflight")]` class: manifest, `Register`, `Health`, `DeclareCapabilities`
- `mod/GonogoTestFlightUplink.Tests/*` — net10.0, compiles only the pure mapper (`TestFlightReliabilityMap.cs`)
- `mod/GonogoTestFlightUplink/NOTICE-TestFlight.txt`

---

## Task 1: Confirm the shared reliability contract exists

**Files:** none (dependency gate)

**Interfaces:**
- Consumes: `ReliabilitySummary`, `ReliabilityPartEntry` (POCOs, `mod/Sitrep.Contract/KerbalismPayloads.cs`), `IReliabilityProvider` (capability interface, `mod/Sitrep.Contract/Comms.cs` or a new `Reliability.cs`) — all from `2026-07-22-kerbalism-uplink.md` Tasks 1 + 6.

- [ ] **Step 1: Verify the contract types resolve**

Run: `cd mod && dotnet build Sitrep.Contract/Sitrep.Contract.csproj -v minimal && grep -rl "ReliabilityPartEntry\|IReliabilityProvider" Sitrep.Contract/`
Expected: both symbols present. If absent, land the Kerbalism spec's Task 1 + Task 6 contract additions first (they define `topic reliability.summary`/`reliability.parts` + the capability interface + specificity election). Do NOT redefine them here — a second definition of `reliability.*` is a Major-contract conflict.

- [ ] **Step 2: Confirm the SDK carries the reliability topic ids**

Run: `pnpm --filter @ksp-gonogo/sitrep-sdk test` (the topic-id assertion from Kerbalism Task 2 includes `reliability.summary`/`reliability.parts`).
Expected: PASS.

---

## Task 2: `TestFlightReflection` — probe + per-engine reads

**Files:**
- Create: `mod/GonogoTestFlightUplink/GonogoTestFlightUplink.csproj`
- Create: `mod/GonogoTestFlightUplink/TestFlightReflection.cs`
- Create: `mod/GonogoTestFlightUplink/NOTICE-TestFlight.txt`
- Modify: `mod/Gonogo.sln`

**Interfaces:**
- Produces: `TestFlightReflection` with `bool IsAvailable`, `IEnumerable<EngineReliabilityRaw> Engines(Vessel v)`, `bool AnyMalfunction(Vessel v)`, `bool AnyCritical(Vessel v)`. All reads degrade to null/empty on a moved/absent surface.

Mirror `mod/GonogoRealAntennasUplink/RaReflection.cs` exactly (probe assembly by name; cache `Type`/`MethodInfo` in the ctor; typed-absence readers). **[verify]** every TestFlight member name below.

- [ ] **Step 1: Write the csproj** — copy `mod/GonogoRealAntennasUplink/GonogoRealAntennasUplink.csproj`; set names to `GonogoTestFlightUplink`, `net48`, MIT, KSP refs `Private="false"`, single `ProjectReference` to `..\Sitrep.Contract\Sitrep.Contract.csproj` `<Private>false</Private>`, NO TestFlight reference.

- [ ] **Step 2: Write the reflection helper**

```csharp
// mod/GonogoTestFlightUplink/TestFlightReflection.cs
// Reflection-only bridge to TestFlight. No compile-time reference to TestFlight*.dll.
// ALL member names are [verify] against TestFlightCore.dll / TestFlightAPI.dll
// (GameData/TestFlight/Plugins/) — resolve on the RO fixture-capture pass.
using System;
using System.Collections.Generic;
using System.Reflection;

namespace GonogoTestFlightUplink
{
    public sealed class TestFlightReflection
    {
        private readonly Assembly? _asm;
        private readonly Type? _coreInterface;   // [verify] "TestFlightAPI.ITestFlightCore"

        public bool IsAvailable => _asm != null && _coreInterface != null;

        public TestFlightReflection()
        {
            foreach (var a in AppDomain.CurrentDomain.GetAssemblies())
            {
                var n = a.GetName().Name;
                if (n != null && n.StartsWith("TestFlight", StringComparison.OrdinalIgnoreCase)) { _asm = a; break; }
            }
            _coreInterface = FindType("TestFlightAPI.ITestFlightCore");   // [verify]
        }

        // Walk part modules; for each part implementing ITestFlightCore read its reliability state.
        public IEnumerable<EngineReliabilityRaw> Engines(Vessel v)
        {
            if (!IsAvailable || v?.parts == null) yield break;
            foreach (var part in v.parts)
            {
                foreach (var pm in part.Modules)
                {
                    var t = pm.GetType();
                    if (_coreInterface == null || !_coreInterface.IsAssignableFrom(t)) continue;
                    // [verify] method names on ITestFlightCore:
                    //   double GetCurrentReliability(double flightData)  OR  GetCurrentReliability()
                    //   double GetFlightData()  /  double GetRatedTime()  /  MomentaryFailureRate
                    var reliability = InvokeDouble(pm, t, "GetCurrentReliability");
                    var flightData = InvokeDouble(pm, t, "GetFlightData");
                    var momentary = InvokeDouble(pm, t, "GetCurrentFailureRate"); // [verify]
                    yield return new EngineReliabilityRaw
                    {
                        PartId = part.flightID.ToString(),
                        Title = part.partInfo?.title ?? part.name,
                        CurrentReliability = reliability ?? 1.0,
                        FlightData = flightData ?? 0,
                        MomentaryFailureRate = momentary ?? 0,
                    };
                }
            }
        }

        public bool AnyMalfunction(Vessel v)
        {
            foreach (var e in Engines(v)) if (e.CurrentReliability < 1.0 && e.MomentaryFailureRate > 0) return true;
            return false;
        }
        public bool AnyCritical(Vessel v)
        {
            foreach (var e in Engines(v)) if (e.CurrentReliability <= 0.01) return true;  // [verify] critical threshold
            return false;
        }

        private static double? InvokeDouble(object target, Type t, string method)
        {
            var m = t.GetMethod(method, BindingFlags.Public | BindingFlags.Instance, null, Type.EmptyTypes, null);
            if (m == null) return null;
            try { return Convert.ToDouble(m.Invoke(target, null)); } catch { return null; }
        }

        private Type? FindType(string fullName)
        {
            if (_asm != null) { try { var t = _asm.GetType(fullName); if (t != null) return t; } catch { } }
            foreach (var a in AppDomain.CurrentDomain.GetAssemblies())
                try { var t = a.GetType(fullName); if (t != null) return t; } catch { }
            return null;
        }
    }

    public sealed class EngineReliabilityRaw
    {
        public string PartId = ""; public string Title = "";
        public double CurrentReliability = 1.0;   // 0..1
        public double FlightData;                  // "du"
        public double MomentaryFailureRate;
    }
}
```

- [ ] **Step 3: Add to solution + build**

Run: `cd mod && dotnet sln Gonogo.sln add GonogoTestFlightUplink/GonogoTestFlightUplink.csproj && dotnet build GonogoTestFlightUplink/GonogoTestFlightUplink.csproj -v minimal /p:KspManaged=<ksp-managed-path>`
Expected: Build succeeded.

- [ ] **Step 4: Commit**

```bash
git add mod/GonogoTestFlightUplink/ mod/Gonogo.sln
git commit -m "feat(testflight): reflection bridge + uplink project scaffold"
```

---

## Task 3: `TestFlightReliabilityMap` — pure mapper (headless-testable)

**Files:**
- Create: `mod/GonogoTestFlightUplink/TestFlightReliabilityMap.cs`
- Create: `mod/GonogoTestFlightUplink.Tests/GonogoTestFlightUplink.Tests.csproj`
- Create: `mod/GonogoTestFlightUplink.Tests/TestFlightReliabilityMapTests.cs`
- Modify: `mod/Gonogo.sln`

**Interfaces:**
- Consumes: `EngineReliabilityRaw` (Task 2).
- Produces: `TestFlightReliabilityMap.Summary(bool anyMalfunction, bool anyCritical) -> Dictionary<string,object?>` (matching `ReliabilitySummary`, `source="testflight"`, `unmodeled=false`) and `TestFlightReliabilityMap.Parts(IEnumerable<EngineReliabilityRaw>) -> List<object>` (matching `ReliabilityPartEntry[]`).

- [ ] **Step 1: Write the failing test**

```csharp
// mod/GonogoTestFlightUplink.Tests/TestFlightReliabilityMapTests.cs
using System.Collections.Generic;
using GonogoTestFlightUplink;
using Xunit;

public class TestFlightReliabilityMapTests
{
    [Fact]
    public void Summary_reports_testflight_modeled()
    {
        var s = TestFlightReliabilityMap.Summary(anyMalfunction: false, anyCritical: false);
        Assert.Equal(false, s["unmodeled"]);
        Assert.Equal("testflight", s["source"]);
    }

    [Fact]
    public void Parts_maps_engine_reliability_to_shared_shape()
    {
        var engines = new[]
        {
            new EngineReliabilityRaw { PartId = "42", Title = "LR-79", CurrentReliability = 0.94, FlightData = 120, MomentaryFailureRate = 0.0003 },
        };
        var parts = TestFlightReliabilityMap.Parts(engines);
        var p = (Dictionary<string, object?>)parts[0];
        Assert.Equal("42", p["partId"]);
        Assert.Equal("LR-79", p["title"]);
        // TestFlight has no ignition/duration fractions; carry reliability in mtbfHours-adjacent fields is wrong,
        // so map reliability onto a dedicated slot the shared shape supports and leave consumed-fractions null.
        Assert.Null(p["ignitionsConsumed"]);
    }
}
```

- [ ] **Step 2: Write the Tests csproj** — copy `mod/GonogoRealAntennasUplink.Tests/GonogoRealAntennasUplink.Tests.csproj`; `<Compile Include="..\GonogoTestFlightUplink\TestFlightReliabilityMap.cs" />` (+ the `EngineReliabilityRaw` file if separated); no ProjectReference to the mod.

- [ ] **Step 3: Run it to verify it fails**

Run: `cd mod && dotnet test GonogoTestFlightUplink.Tests/GonogoTestFlightUplink.Tests.csproj`
Expected: FAIL to compile.

- [ ] **Step 4: Write the pure mapper**

```csharp
// mod/GonogoTestFlightUplink/TestFlightReliabilityMap.cs
using System.Collections.Generic;

namespace GonogoTestFlightUplink
{
    public static class TestFlightReliabilityMap
    {
        public static Dictionary<string, object?> Summary(bool anyMalfunction, bool anyCritical) => new()
        {
            ["unmodeled"] = false,
            ["malfunction"] = anyMalfunction,
            ["critical"] = anyCritical,
            ["source"] = "testflight",
        };

        public static List<object> Parts(IEnumerable<EngineReliabilityRaw> engines)
        {
            var list = new List<object>();
            foreach (var e in engines)
                list.Add(new Dictionary<string, object?>
                {
                    ["partId"] = e.PartId,
                    ["title"] = e.Title,
                    ["group"] = "engine",
                    ["broken"] = e.CurrentReliability <= 0.01,
                    ["critical"] = e.MomentaryFailureRate > 0,
                    // TestFlight expresses health as a live reliability probability, not consumed fractions.
                    // mtbfHours carries the inverse-failure-rate estimate; ignitions/duration consumed stay null
                    // (Kerbalism-only concepts). The FleetRoster renderer shows whichever fields are non-null.
                    ["mtbfHours"] = e.MomentaryFailureRate > 0 ? (double?)(1.0 / e.MomentaryFailureRate / 3600.0) : null,
                    ["ignitionsConsumed"] = null,
                    ["durationConsumed"] = null,
                    ["needsRepair"] = e.CurrentReliability < 1.0,
                });
            return list;
        }
    }
}
```

- [ ] **Step 5: Run tests to verify pass**

Run: `cd mod && dotnet test GonogoTestFlightUplink.Tests/GonogoTestFlightUplink.Tests.csproj`
Expected: PASS (2 tests).

- [ ] **Step 6: Add Tests project to solution + commit**

```bash
cd mod && dotnet sln Gonogo.sln add GonogoTestFlightUplink.Tests/GonogoTestFlightUplink.Tests.csproj && cd ..
git add mod/GonogoTestFlightUplink/TestFlightReliabilityMap.cs mod/GonogoTestFlightUplink.Tests/ mod/Gonogo.sln
git commit -m "feat(testflight): pure reliability mapper + headless tests"
```

---

## Task 4: `TestFlightUplink` — capability provider, manifest, health

**Files:**
- Create: `mod/GonogoTestFlightUplink/TestFlightReliabilityProvider.cs`
- Create: `mod/GonogoTestFlightUplink/TestFlightUplink.cs`

**Interfaces:**
- Consumes: `IReliabilityProvider` (shared, Kerbalism Task 6), `TestFlightReflection` (Task 2), `TestFlightReliabilityMap` (Task 3), the Kernel capability API + `IUplinkHost` seams.
- Produces: the `[SitrepUplink("testflight")]` uplink; `testflight.available` (TrueNow); registers a specificity-10 `reliability` capability provider.

- [ ] **Step 1: Implement the provider**

```csharp
// mod/GonogoTestFlightUplink/TestFlightReliabilityProvider.cs
using Sitrep.Contract;

namespace GonogoTestFlightUplink
{
    public sealed class TestFlightReliabilityProvider : IReliabilityProvider
    {
        private readonly TestFlightReflection _tf;
        public TestFlightReliabilityProvider(TestFlightReflection tf) => _tf = tf;

        public bool IsModeled => _tf.IsAvailable;   // TestFlight always models when present
        public object? Summary(Vessel v) =>
            TestFlightReliabilityMap.Summary(_tf.AnyMalfunction(v), _tf.AnyCritical(v));
        public object? Parts(Vessel v) =>
            TestFlightReliabilityMap.Parts(_tf.Engines(v));
    }
}
```

- [ ] **Step 2: Write the uplink**

```csharp
// mod/GonogoTestFlightUplink/TestFlightUplink.cs
using System.Collections.Generic;
using Sitrep.Contract;

namespace GonogoTestFlightUplink
{
    [SitrepUplink("testflight")]
    public sealed class TestFlightUplink : ISitrepUplink, IUplinkCapabilityDeclarer
    {
        private const string AvailableTopic = "testflight.available";
        private readonly TestFlightReflection _tf = new();

        public UplinkManifest Manifest { get; }

        public TestFlightUplink()
        {
            Manifest = new UplinkManifest
            {
                Id = "testflight",
                Version = "1.0.0",
                Channels = new List<ChannelDeclaration>
                {
                    new ChannelDeclaration
                    {
                        Topic = AvailableTopic, Delivery = Delivery.LossyLatest,
                        Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
                        Delay = DelayRole.TrueNow,
                    },
                    // reliability.* topics are declared by whichever uplink publishes them; if the elected
                    // provider publishes via the electing uplink, declare them here too. Mirror the comms
                    // precedent EXACTLY (does CommsCoreUplink declare comms.* while RA provides the backend?).
                },
            };
        }

        public void DeclareCapabilities(Kernel kernel)
        {
            // Specificity 10 > Kerbalism's 1 → TestFlight wins the election when both are live.
            if (_tf.IsAvailable)
                kernel.Provide<IReliabilityProvider>("reliability", new TestFlightReliabilityProvider(_tf), specificity: 10);
        }

        public void Register(IUplinkHost host)
        {
            host.AddChannelSource(AvailableTopic, _ => _tf.IsAvailable);
            // The reliability.* publishing is owned by the elected-provider wiring. Follow the comms
            // precedent: if CommsCoreUplink is the one that queries the elected backend and publishes
            // comms.*, then the equivalent reliability publisher lives in ONE place (likely a small
            // core ReliabilityCoreUplink or the electing host), NOT duplicated per provider. Confirm the
            // ownership against CommsCoreUplink before wiring, and keep it identical in the Kerbalism spec.
        }

        public UplinkHealth Health() =>
            _tf.IsAvailable ? UplinkHealth.Healthy : UplinkHealth.Unavailable("TestFlight assembly not loaded");
    }
}
```

- [ ] **Step 3: Resolve the reliability-publisher ownership question**

Read `mod/Gonogo.KSP/CommsCoreUplink.cs` end-to-end. Determine: for the `comms` capability, WHICH uplink declares the `comms.*` channels and publishes the elected backend's data. Apply the identical pattern for `reliability.*` — a single publisher that queries `kernel`/`host` for the elected `IReliabilityProvider` and publishes `reliability.summary`/`reliability.parts`. If comms uses a dedicated core uplink, add a tiny `ReliabilityCoreUplink` in `mod/Gonogo.KSP/` (declared once in the Kerbalism spec's scope) rather than per-provider. Document the decision in BOTH this file and `2026-07-22-kerbalism-uplink.md` so the two specs stay in lock-step.

- [ ] **Step 4: Build + commit**

Run: `cd mod && dotnet build GonogoTestFlightUplink/GonogoTestFlightUplink.csproj -v minimal /p:KspManaged=<path>`
Expected: Build succeeded.

```bash
git add mod/GonogoTestFlightUplink/TestFlightUplink.cs mod/GonogoTestFlightUplink/TestFlightReliabilityProvider.cs
git commit -m "feat(testflight): reliability capability provider (specificity 10, supersedes Kerbalism)"
```

---

## Task 5: Deploy + live-verify checklist (RO fixture-capture pass)

**Files:** none (verification task — runs when the Deck next has RP-1 installed)

- [ ] **Step 1: `ilspycmd` the TestFlight assemblies to lock the [verify] symbols**

Dump `TestFlightCore.dll` + `TestFlightAPI.dll` (`GameData/TestFlight/Plugins/`) and confirm the real `ITestFlightCore` interface FQN + method signatures used in Task 2 (`GetCurrentReliability`, `GetFlightData`, failure-rate accessor). Fix `TestFlightReflection.cs` to the real names. Re-run `dotnet test` — the pure mapper tests are unaffected (they test the map, not reflection).

- [ ] **Step 2: Capture an RO reliability fixture**

Per `local_docs/kerbalism-fixture-run-RUNBOOK.md`, extend `GonogoDevKerbalismDump` (or a sibling `GonogoDevTestFlightDump`) to reflect `ITestFlightCore` per engine on a crewed RP-1 test craft, dump to `local_docs/ro-fixtures/testflight-<scenario>.json`. Add a headless mapper test grounded in that fixture (mirror the Kerbalism `KerbalismCaptureTests` pattern).

- [ ] **Step 3: Live-verify the election under RP-1**

With RP-1 loaded (Kerbalism `Features.Reliability = false`), confirm `system.uplinks` shows `testflight` Healthy + `kerbalism` reporting reliability `unmodeled`, and that `reliability.summary.source == "testflight"` on the wire. Record the result in `local_docs/feature_log/`.

## Self-Review

- **Spec coverage:** TestFlight as RO reliability authority (Tasks 2-4) ✓; higher-specificity capability provider superseding Kerbalism (Task 4, cross-ref Kerbalism Task 6) ✓; reflection-only, presence-gated, mandatory health, delay-gated ✓; per-engine data on the SHARED `ReliabilityPartEntry` shape so FleetRoster is source-agnostic ✓; `rel_ignitions/duration` fractions stay Kerbalism-only (null for TestFlight) per the research ✓.
- **Out of scope (correctly):** the FleetRoster widget + its `line-updates` slot that RENDERS `reliability.*` — that is a separate widget spec (reliability rendering is source-agnostic, like `comms.*` → FleetComms).
- **VERIFY tags** cover every TestFlight symbol (no RO fixtures captured yet) — this is expected and gated by Task 5.
- **Open coordination:** the capability publisher-ownership question (Task 3/4 Step 3) MUST be resolved against `CommsCoreUplink` and kept identical in `2026-07-22-kerbalism-uplink.md` Task 6.
