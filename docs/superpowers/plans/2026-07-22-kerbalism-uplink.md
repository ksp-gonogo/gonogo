# KerbalismUplink Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a full-vertical-slice `KerbalismUplink` — a C# Sitrep uplink that emits every Kerbalism telemetry domain the reflection-dump fixtures prove (space weather, life support, habitat, processes, per-kerbal survival rules, features, reliability), plus a `@ksp-gonogo/kerbalism` client package that owns the migrated SpaceWeather and LifeSupportSystems widgets reading `useTelemetry("kerbalism.spaceweather")` / `("kerbalism.lifesupport")` instead of raw `sw.*` / `ls.*` keys.

**Architecture:** One Domain, `kerbalism`, owned by one uplink class `[SitrepUplink("kerbalism")] KerbalismUplink : ISitrepUplink` (mod side, `mod/GonogoKerbalismUplink/`). All live Kerbalism reads go through a `KerbalismReflection` helper (adapted verbatim from the proven `mod/GonogoDevTools/GonogoDevKerbalismDump.cs` — that same reflection produced the fixtures) so there is **zero** compile-time link to Kerbalism (license-clean, presence-safe). Structured Topic payloads are POCOs in `Sitrep.Contract` that flow through `mod/codegen.sh` into the typed `@ksp-gonogo/sitrep-sdk`. The client package (`mod/GonogoKerbalismUplink/client/`, package `@ksp-gonogo/kerbalism`) imports the sealed facade `@ksp-gonogo/sitrep-sdk`, composes `@ksp-gonogo/ui-kit`, and hosts the two existing widgets (moved out of `packages/components`, which is the CLAUDE.md-mandated Uplink-ownership pattern). Reliability is emitted through the Kernel `reliability` capability (comms-precedent) so `TestFlightUplink` can supersede it under RO — see `2026-07-22-testflight-uplink.md`.

**Tech Stack:** C# net48 (mod) / netstandard2.0 (contract codegen target) / net10.0 (mod tests, xunit); TypeScript + React 18 + styled-components + Vitest + jest-axe (client); Reinforced.Typings codegen; pnpm workspaces.

## Global Constraints

- Work ONLY in your own worktree on a NEW branch off **staging** (`git checkout -b agent-N/<slug> staging`); verify `git branch --show-current` before starting
- Commit locally, NEVER push; author as a human (no AI attribution trailer, no trailing periods on bullets, no em-dashes)
- Pre-commit runs biome + cross-package typecheck (~20-30s); if it fails, read + fix, re-commit; NEVER `--no-verify`
- Vocabulary is strict: **Domain** (uplink prefix `kerbalism`), **Topic** (subscription/keyframe unit e.g. `kerbalism.spaceweather`), **Value** (one field inside a Topic); say "Topic" never "channel" (the C# class name `ChannelDeclaration` is the only surviving "channel" use)
- No Uplink talks to another; cross-uplink coordination is only via the Kernel capability election (`ctx.Query<T>("...")`), never one uplink reading another's settings
- Presence gate every Domain with a `<domain>.available` Topic (`DelayRole.TrueNow`, bare boolean); ground-side facts (features, presence) are `TrueNow`, everything vessel-telemetric is `DelayRole.Delayed`
- `Health()` is a mandatory `ISitrepUplink` member; report the TRUE state (Unavailable + reason when Kerbalism is absent)
- New Topic families with a structured payload MUST define a `[SitrepTopic]`-tagged POCO in `Sitrep.Contract` + register it in `RtConfig.cs` + run `mod/codegen.sh`; bare-primitive topics owned solely by this uplink are declared client-side via `registerBarePrimitiveTopic`
- Contract version (`mod/Sitrep.Contract/ContractVersion.cs`, currently Major 4): additive new type/field = bump **Minor**; removed/renamed/retyped wire member = bump **Major**
- Widgets carry ~zero bespoke CSS: compose `@ksp-gonogo/ui-kit` primitives; follow the accessibility baseline in the repo CLAUDE.md (real `<button>`, labelled inputs, `role="status"` for mission-state changes, `prefers-reduced-motion` guards, 4.5:1 / 3:1 contrast, a `jest-axe` smoke assertion per widget)
- **Ground every Value in real captured data:** `/Users/jon.pepler/personal/gonogo/local_docs/kerbalism-fixtures/` (canonical: `kerbalism-fixture-baseline-crp.json`; belt sweep: `alt-2000`, `inner-1600`, `alt-6500`; README documents which states are captured vs must be synthesised). Fields not present in any captured fixture are tagged **[fixture-confirm]** and default safely
- **Reflection ground truth:** `mod/GonogoDevTools/GonogoDevKerbalismDump.cs` already performs every reflection call this uplink needs against LIVE Kerbalism 3.32 + CRP v112 — port its calls, do not reinvent them

---

## Reference: the captured Kerbalism surface (baseline-crp fixture)

Every Value below is a real key in `kerbalism-fixture-baseline-crp.json` unless tagged. The dump wrote `api.<Method>` for `(Vessel)` methods and `api.<Method>[Resource]` for `(Vessel,string)` methods on `KERBALISM.API` (type resolves as `KERBALISM.API` ?? `Kerbalism.API` ?? `Kerbalism.System.API`).

- **Space weather** (`api.*`): `Radiation` (float, environment rad), `HabitatRadiation` (float, effective-in-habitat), `Magnetosphere`/`InnerBelt`/`OuterBelt` (bool), `StormIncoming`/`StormInProgress`/`Blackout` (bool), `InSunlight`/`Breathable` (bool). **[fixture-confirm]** radiation units: Kerbalism source returns rad/s; the fixture README labels the captured 3.98e-06 value "rad/h". The uplink emits the raw API value on `radiationRadPerSecond`; the client multiplies by 3600 for the rad/h display and the widget test asserts the conversion. Confirm against a live storm capture before locking.
- **Life support** (`api.ResourceAmount|ResourceCapacity|ResourceAverageRate[<res>]`): resources `Food`, `Water`, `Oxygen`, `ElectricCharge` (+ byproduct rates `Waste`, `WasteWater`). Rate is signed net units/s (negative = draining). Habitat scalars (`api.*`): `Volume`, `Surface`, `Pressure` (0..1 normalised; baseline 0 = mk1pod unpressurised), `Poisoning` (CO2), `Shielding` (0..1), `LivingSpace`, `Comfort`.
- **Processes** (`processes[]`, ProcessController PartModules): `resource` (e.g. `_Scrubber`), `title` ("Scrubber"), `capacity`, `running` (bool), `broken` (bool). Baseline has 4: Scrubber, Water recycler, Waste processor (running), Monoprop+O2 fuel cell (idle).
- **Per-kerbal** (`kerbals[]`): `name`, `trait`, `rules` dict keyed by rule name (`eating`, `drinking`, `breathing`, `climatization`, `co2 poisoning`, `stress`, `radiation`) → `problem` accumulator value. `radiation` is the accumulated dose. **The dump tool captures only these accumulator VALUES** (from `KerbalData.rules`). The uplink must ALSO reflect the per-rule config constants `degeneration` (degen rate, units/s) and `fatal_threshold` from `Profile.rules[]` (the loaded profile's rule definitions — a different, static source), because the client death-clock is two-stage: stage 1 is resource-time-to-empty (from `kerbalism.lifesupport` rates), stage 2 is accumulator-time-to-fatal, and stage 2 needs `(fatal_threshold - value) / degeneration`. Degeneration only starts once the linked resource hits zero. `Profile.rules[]` is captured **[fixture-confirm]** (not in the current fixtures — add a degen-constant capture to the dump tool per the runbook when the Deck is next reachable).
- **Reliability** (`api.Malfunction`/`api.Critical` bool). Per-part list is `ReliabilityInfo.BuildList(Vessel)` (fields `title, group, broken, critical, partId, mtbf, rel_duration, rel_ignitions` + `NeedsMaintenance()`); `rel_ignitions`/`rel_duration` are fractions CONSUMED (1.0 = spent), so pre-burn "remaining" = `1 - value`.
- **Features** (`features.*`, 13 bools): `Reliability`, `Deploy`, `Science`, `SpaceWeather`, `Automation`, `Radiation`, `Shielding`, `LivingSpace`, `Comfort`, `Poisoning`, `Pressure`, `Habitat`, `Supplies`. Read from `KERBALISM.Features` public static fields. Under RO, `Reliability = false` (TestFlight owns engine failures) — this is the per-domain "unmodeled vs healthy" gate.
- **Greenhouse** (`greenhouses[]`, Greenhouse PartModules) — **[fixture-confirm]** the tester vessel had none; fields `growth`/`tta`/`natural`/`artificial`/`issue`/`crop_resource` per the 2026-07-13 values catalog. Emitted but only exercised by a synthetic fixture in this plan.

## File Structure

Mod side (`mod/GonogoKerbalismUplink/`):
- `KerbalismReflection.cs` — presence probe + cached `MethodInfo`/`Type` handles + typed-absence readers (ported from `GonogoDevKerbalismDump.cs`). KSP-referencing (needs `Vessel`), so it is the reflection shell.
- `KerbalismCapture.cs` — pure plain-data capture struct + `Build*` mappers (NO live handles, NO KSP types beyond the input) → unit-testable headlessly.
- `KerbalismUplink.cs` — the `[SitrepUplink("kerbalism")]` class: manifest, `Register`, `Health`, `DeclareCapabilities` (reliability).
- `GonogoKerbalismUplink.csproj` (net48) + `GonogoKerbalismUplink.Tests.csproj` (net10.0, compiles only `KerbalismCapture.cs`).

Contract (`mod/Sitrep.Contract/`):
- `KerbalismPayloads.cs` — `[SitrepTopic]` POCOs: `KerbalismSpaceWeather`, `KerbalismLifeSupport`, `KerbalismHabitat`, `KerbalismProcessEntry`, `KerbalismCrewEntry`, `KerbalismFeatures`, `ReliabilitySummary`, `ReliabilityPartEntry`.
- Edit `RtConfig.cs` (register the POCOs) + `ContractVersion.cs` (Minor bump).

Client (`mod/GonogoKerbalismUplink/client/`, package `@ksp-gonogo/kerbalism`):
- `package.json`, `tsconfig.json`, `vitest.config.ts`, `src/index.ts` — scaffold from `mod/GonogoScansatUplink/client/`.
- `src/topics.ts` — `registerBarePrimitiveTopic("kerbalism.available")` + the `declare module` augment.
- `src/SpaceWeather/` and `src/LifeSupportSystems/` — the two widgets MOVED from `packages/components/src/`, data hook swapped to `useTelemetry`.

App + shim:
- `packages/app/src/main.tsx` + `packages/app/package.json` — dynamic-import + dep the package.
- `packages/sitrep-client/src/map-topic.ts` + coverage test — legacy `sw.*`/`ls.*` → Topic fallback entries.

---

## Task 1: Contract payloads for the Kerbalism Topics

**Files:**
- Create: `mod/Sitrep.Contract/KerbalismPayloads.cs`
- Modify: `mod/Sitrep.Contract/RtConfig.cs` (add the POCOs to `ExportAsInterfaces`)
- Modify: `mod/Sitrep.Contract/ContractVersion.cs` (bump `Minor`)

**Interfaces:**
- Produces: the wire POCOs consumed by codegen (Task 2) and the uplink source builders (Task 5). Topic ids: `kerbalism.spaceweather` → `KerbalismSpaceWeather`, `kerbalism.lifesupport` → `KerbalismLifeSupport`, `kerbalism.crew` → `KerbalismCrewEntry[]`, `kerbalism.features` → `KerbalismFeatures`, `reliability.summary` → `ReliabilitySummary`, `reliability.parts` → `ReliabilityPartEntry[]`. `kerbalism.available` is a bare boolean declared client-side (Task 8), NOT here.

- [ ] **Step 1: Write the payloads file**

Follow the existing convention exactly (see `mod/Sitrep.Contract/ScanPayloads.cs`): each POCO tagged `[SitrepContract]`, `[TsInterface]` under `#if NETSTANDARD2_0`, root types `[SitrepTopic("id")]` (with `isArray: true` for array topics), all members nullable, camelCase mirrors of the serialized shape.

```csharp
// mod/Sitrep.Contract/KerbalismPayloads.cs
// Wire payloads for the KerbalismUplink Domain. These mirror the shapes produced
// by KerbalismCapture.Build* (mod/GonogoKerbalismUplink) field-for-field; they exist
// for typing + codegen only. Grounded in kerbalism-fixture-baseline-crp.json.
using System.Collections.Generic;
#if NETSTANDARD2_0
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract
{
    [SitrepContract]
#if NETSTANDARD2_0
    [TsInterface]
#endif
    [SitrepTopic("kerbalism.spaceweather")]
    public sealed class KerbalismSpaceWeather
    {
        /// <summary>Raw API.Radiation(v). Units [fixture-confirm]: Kerbalism source is rad/s; client *3600 for rad/h.</summary>
        public double? RadiationRadPerSecond { get; set; }
        public double? HabitatRadiationRadPerSecond { get; set; }
        public bool? Magnetosphere { get; set; }
        public bool? InnerBelt { get; set; }
        public bool? OuterBelt { get; set; }
        public bool? StormIncoming { get; set; }
        public bool? StormInProgress { get; set; }
        public bool? Blackout { get; set; }
        public bool? InSunlight { get; set; }
        /// <summary>Shielding resource amount/capacity (0 in the default profile; present under RO/Habitat).</summary>
        public double? ShieldingAmount { get; set; }
        public double? ShieldingCapacity { get; set; }
    }

    [SitrepContract]
#if NETSTANDARD2_0
    [TsInterface]
#endif
    public sealed class KerbalismResource
    {
        public double? Amount { get; set; }
        public double? Capacity { get; set; }
        /// <summary>Signed net units/s. Negative = draining.</summary>
        public double? Rate { get; set; }
    }

    [SitrepContract]
#if NETSTANDARD2_0
    [TsInterface]
#endif
    public sealed class KerbalismHabitat
    {
        public double? Pressure { get; set; }      // 0..1 normalised
        public double? Poisoning { get; set; }     // CO2 level
        public double? Shielding { get; set; }     // 0..1 factor
        public double? LivingSpace { get; set; }   // factor
        public double? Comfort { get; set; }       // factor
        public double? Volume { get; set; }        // m^3
        public double? Surface { get; set; }       // m^2
    }

    [SitrepContract]
#if NETSTANDARD2_0
    [TsInterface]
#endif
    public sealed class KerbalismProcessEntry
    {
        public string? Resource { get; set; }   // e.g. "_Scrubber"
        public string? Title { get; set; }       // e.g. "Scrubber"
        public double? Capacity { get; set; }
        public bool? Running { get; set; }
        public bool? Broken { get; set; }
    }

    [SitrepContract]
#if NETSTANDARD2_0
    [TsInterface]
#endif
    [SitrepTopic("kerbalism.lifesupport")]
    public sealed class KerbalismLifeSupport
    {
        public KerbalismResource? Food { get; set; }
        public KerbalismResource? Water { get; set; }
        public KerbalismResource? Oxygen { get; set; }
        public KerbalismResource? ElectricCharge { get; set; }
        public KerbalismHabitat? Habitat { get; set; }
        public List<KerbalismProcessEntry>? Processes { get; set; }
    }

    [SitrepContract]
#if NETSTANDARD2_0
    [TsInterface]
#endif
    public sealed class KerbalismCrewRule
    {
        public string? Name { get; set; }              // e.g. "radiation", "stress", "co2 poisoning"
        /// <summary>Current accumulator value ("problem") from KerbalData.rules.</summary>
        public double? Value { get; set; }
        /// <summary>Per-rule degeneration rate (units/s) from Profile.rules[].degeneration. Stage-2 death-clock input. [fixture-confirm]</summary>
        public double? DegenPerSec { get; set; }
        /// <summary>Fatal accumulator threshold from Profile.rules[].fatal_threshold. [fixture-confirm]</summary>
        public double? FatalThreshold { get; set; }
    }

    [SitrepContract]
#if NETSTANDARD2_0
    [TsInterface]
#endif
    [SitrepTopic("kerbalism.crew", isArray: true)]
    public sealed class KerbalismCrewEntry
    {
        public string? Name { get; set; }
        public string? Trait { get; set; }
        /// <summary>Per-rule value + degen constants (radiation dose is the rule named "radiation").</summary>
        public List<KerbalismCrewRule>? Rules { get; set; }
        /// <summary>Optional mod-computed soonest-fatal countdown (s), folding resource-time-to-empty + stage-2 degen. Null when not derivable. [fixture-confirm]</summary>
        public double? DeathClockSec { get; set; }
    }

    [SitrepContract]
#if NETSTANDARD2_0
    [TsInterface]
#endif
    [SitrepTopic("kerbalism.features")]
    public sealed class KerbalismFeatures
    {
        public bool? Reliability { get; set; }
        public bool? Radiation { get; set; }
        public bool? SpaceWeather { get; set; }
        public bool? Shielding { get; set; }
        public bool? LivingSpace { get; set; }
        public bool? Comfort { get; set; }
        public bool? Poisoning { get; set; }
        public bool? Pressure { get; set; }
        public bool? Habitat { get; set; }
        public bool? Supplies { get; set; }
        public bool? Science { get; set; }
        public bool? Automation { get; set; }
        public bool? Deploy { get; set; }
    }

    [SitrepContract]
#if NETSTANDARD2_0
    [TsInterface]
#endif
    [SitrepTopic("reliability.summary")]
    public sealed class ReliabilitySummary
    {
        /// <summary>True when the elected provider does not model reliability (Kerbalism with Features.Reliability off).</summary>
        public bool? Unmodeled { get; set; }
        public bool? Malfunction { get; set; }
        public bool? Critical { get; set; }
        public string? Source { get; set; }   // "kerbalism" | "testflight"
    }

    [SitrepContract]
#if NETSTANDARD2_0
    [TsInterface]
#endif
    [SitrepTopic("reliability.parts", isArray: true)]
    public sealed class ReliabilityPartEntry
    {
        public string? PartId { get; set; }
        public string? Title { get; set; }
        public string? Group { get; set; }
        public bool? Broken { get; set; }
        public bool? Critical { get; set; }
        public double? MtbfHours { get; set; }
        /// <summary>Fraction of rated ignitions CONSUMED (1.0 = spent). Remaining = 1 - value.</summary>
        public double? IgnitionsConsumed { get; set; }
        public double? DurationConsumed { get; set; }
        public bool? NeedsRepair { get; set; }
    }
}
```

- [ ] **Step 2: Register the POCOs for codegen**

In `mod/Sitrep.Contract/RtConfig.cs`, add each new type to the `ExportAsInterfaces(new[] { ... })` list (alongside the scansat/comms entries).

```csharp
typeof(KerbalismSpaceWeather), typeof(KerbalismResource), typeof(KerbalismHabitat),
typeof(KerbalismProcessEntry), typeof(KerbalismLifeSupport),
typeof(KerbalismCrewRule), typeof(KerbalismCrewEntry),
typeof(KerbalismFeatures), typeof(ReliabilitySummary), typeof(ReliabilityPartEntry),
```

- [ ] **Step 3: Bump the contract Minor version**

In `mod/Sitrep.Contract/ContractVersion.cs` increment `public const int Minor` by 1 (these are additive-only new types → Minor bump, never Major) and add a `<para>` note describing the Kerbalism payloads.

- [ ] **Step 4: Build the contract to verify it compiles**

Run: `cd mod && dotnet build Sitrep.Contract/Sitrep.Contract.csproj -v minimal`
Expected: Build succeeded, 0 errors (both `netstandard2.0` and `net472` target frameworks).

- [ ] **Step 5: Commit**

```bash
git add mod/Sitrep.Contract/KerbalismPayloads.cs mod/Sitrep.Contract/RtConfig.cs mod/Sitrep.Contract/ContractVersion.cs
git commit -m "feat(contract): Kerbalism Topic payloads (spaceweather, lifesupport, crew, features, reliability)"
```

---

## Task 2: Regenerate the SDK and assert the Topic ids land

**Files:**
- Modify (generated): `mod/sitrep-sdk/src/__generated__/contract.ts`, `mod/sitrep-sdk/src/__generated__/topic-map.ts`
- Test: `mod/sitrep-sdk/src/topics.test.ts` (create if absent; else extend)

**Interfaces:**
- Consumes: the POCOs from Task 1.
- Produces: `TopicId` union members `"kerbalism.spaceweather" | "kerbalism.lifesupport" | "kerbalism.crew" | "kerbalism.features" | "reliability.summary" | "reliability.parts"` and their `TopicPayload<...>` map entries, importable from `@ksp-gonogo/sitrep-sdk`.

- [ ] **Step 1: Write the failing test**

```ts
// mod/sitrep-sdk/src/topics.test.ts
import { describe, expect, it } from "vitest";
import { GENERATED_TOPIC_IDS } from "./__generated__/topic-map";

describe("kerbalism topics in generated SDK", () => {
  it("includes every KerbalismUplink topic", () => {
    for (const id of [
      "kerbalism.spaceweather", "kerbalism.lifesupport", "kerbalism.crew",
      "kerbalism.features", "reliability.summary", "reliability.parts",
    ]) {
      expect(GENERATED_TOPIC_IDS).toContain(id);
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @ksp-gonogo/sitrep-sdk test`
Expected: FAIL (the ids are not yet in the generated map).

- [ ] **Step 3: Regenerate the SDK**

Run: `cd mod && ./codegen.sh`
Expected: prints `codegen -> .../contract.ts` and `codegen -> .../topic-map.ts`; the diff adds the six topic ids to `GENERATED_TOPIC_IDS` and the payload interfaces to `contract.ts`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @ksp-gonogo/sitrep-sdk test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mod/sitrep-sdk/src/__generated__/ mod/sitrep-sdk/src/topics.test.ts
git commit -m "chore(sitrep-sdk): regenerate contract for Kerbalism topics"
```

---

## Task 3: `KerbalismReflection` — presence probe + cached handles

**Files:**
- Create: `mod/GonogoKerbalismUplink/GonogoKerbalismUplink.csproj`
- Create: `mod/GonogoKerbalismUplink/KerbalismReflection.cs`
- Create: `mod/GonogoKerbalismUplink/NOTICE-Kerbalism.txt` (attribution note — reflection-only, no linked code)
- Modify: `mod/Gonogo.sln` (add the project)

**Interfaces:**
- Produces: `KerbalismReflection` with `bool IsAvailable`, `double? Api(string method, Vessel v)`, `double? ApiResource(string method, Vessel v, string resource)`, `bool? ApiBool(string method, Vessel v)`, `IReadOnlyDictionary<string, bool> Features()`, `IEnumerable<KerbalRulesRaw> CrewRules(Vessel v)`, `IReadOnlyDictionary<string, RuleConstants> RuleConstants()` (per-rule `degeneration`/`fatal_threshold` from the loaded `Profile.rules`, resolved once — static, vessel-independent), `IEnumerable<ProcessRaw> Processes(Vessel v)`, `ReliabilityRaw? Reliability(Vessel v)`. All degrade to null/empty on a moved surface (never throw).

This is the reflection shell. It references KSP (`Vessel`) so it lives in the net48 project and is NOT compiled into the headless test project. Port the exact reflection calls from `mod/GonogoDevTools/GonogoDevKerbalismDump.cs` (which produced the fixtures) — this is proven code, adapt don't reinvent. Mirror the structure of `mod/GonogoRealAntennasUplink/RaReflection.cs` (probe assembly by name; cache handles once in the ctor; typed-absence readers).

- [ ] **Step 1: Write the csproj**

Copy `mod/GonogoRealAntennasUplink/GonogoRealAntennasUplink.csproj` (the reflection-only, MIT-licensed template — NOT the SCANsat one which compile-links). Change `AssemblyName`/`RootNamespace` to `GonogoKerbalismUplink`, keep `<TargetFramework>net48</TargetFramework>`, `LangVersion 12`, `Nullable enable`, KSP refs via `$(KspManaged)` with `Private="false"`, the single `ProjectReference` to `..\Sitrep.Contract\Sitrep.Contract.csproj` with `<Private>false</Private>`, and `<PackageLicenseExpression>MIT</PackageLicenseExpression>` (reflection only, no Kerbalism code linked). Do NOT reference any Kerbalism DLL.

- [ ] **Step 2: Write the reflection helper**

```csharp
// mod/GonogoKerbalismUplink/KerbalismReflection.cs
// Reflection-only bridge to Kerbalism. No compile-time reference to Kerbalism.dll.
// Every call degrades to null on a moved/absent surface. Ported from the proven
// reflection in mod/GonogoDevTools/GonogoDevKerbalismDump.cs.
using System;
using System.Collections;
using System.Collections.Generic;
using System.Reflection;

namespace GonogoKerbalismUplink
{
    public sealed class KerbalismReflection
    {
        private readonly Assembly? _asm;
        private readonly Type? _apiType;
        private readonly Type? _featuresType;
        private readonly Type? _dbType;
        private readonly MethodInfo? _dbKerbal;
        private readonly Dictionary<string, MethodInfo> _apiVessel = new();
        private readonly Dictionary<string, MethodInfo> _apiVesselString = new();

        public bool IsAvailable => _asm != null && _apiType != null;

        public KerbalismReflection()
        {
            foreach (var a in AppDomain.CurrentDomain.GetAssemblies())
            {
                var n = a.GetName().Name;
                if (string.Equals(n, "Kerbalism", StringComparison.OrdinalIgnoreCase)) { _asm = a; break; }
            }
            _apiType = FindType("KERBALISM.API") ?? FindType("Kerbalism.API") ?? FindType("Kerbalism.System.API");
            _featuresType = FindType("KERBALISM.Features") ?? FindType("Kerbalism.Features") ?? FindType("Kerbalism.System.Features");
            _dbType = FindType("KERBALISM.DB") ?? FindType("Kerbalism.DB") ?? FindType("Kerbalism.Database.DB");
            _dbKerbal = _dbType?.GetMethod("Kerbal", BindingFlags.Public | BindingFlags.Static);
            if (_apiType != null)
            {
                foreach (var m in _apiType.GetMethods(BindingFlags.Public | BindingFlags.Static))
                {
                    var ps = m.GetParameters();
                    if (ps.Length == 1 && ps[0].ParameterType.Name == "Vessel") _apiVessel[m.Name] = m;
                    else if (ps.Length == 2 && ps[0].ParameterType.Name == "Vessel" && ps[1].ParameterType == typeof(string))
                        _apiVesselString[m.Name] = m;
                }
            }
        }

        public double? Api(string method, Vessel v) => AsDouble(InvokeVessel(method, v));
        public bool? ApiBool(string method, Vessel v) => InvokeVessel(method, v) as bool?;
        public double? ApiResource(string method, Vessel v, string resource) =>
            AsDouble(InvokeVesselString(method, v, resource));

        private object? InvokeVessel(string method, Vessel v)
        {
            if (!_apiVessel.TryGetValue(method, out var m)) return null;
            try { return m.Invoke(null, new object[] { v }); } catch { return null; }
        }

        private object? InvokeVesselString(string method, Vessel v, string resource)
        {
            if (!_apiVesselString.TryGetValue(method, out var m)) return null;
            try { return m.Invoke(null, new object[] { v, resource }); } catch { return null; }
        }

        public IReadOnlyDictionary<string, bool> Features()
        {
            var result = new Dictionary<string, bool>();
            if (_featuresType == null) return result;
            foreach (var f in _featuresType.GetFields(BindingFlags.Public | BindingFlags.Static))
                if (f.FieldType == typeof(bool))
                    try { result[f.Name] = (bool)(f.GetValue(null) ?? false); } catch { }
            return result;
        }

        // Per-rule config constants from the LOADED profile (Profile.rules[] — static, vessel-independent).
        // The dump tool does NOT capture these; they feed the stage-2 death-clock. Resolve the Profile
        // singleton (KERBALISM.Profile.rules is a List<Rule>; each Rule has public fields
        // name/degeneration/fatal_threshold [fixture-confirm exact names]) once and cache.
        public IReadOnlyDictionary<string, RuleConstants> RuleConstants()
        {
            var result = new Dictionary<string, RuleConstants>();
            var profileType = FindType("KERBALISM.Profile") ?? FindType("Kerbalism.Profile");
            var rulesField = profileType?.GetField("rules", BindingFlags.Public | BindingFlags.Static);
            if (rulesField?.GetValue(null) is IEnumerable rules)
                foreach (var rule in rules)
                {
                    var t = rule.GetType();
                    var name = t.GetField("name")?.GetValue(rule) as string;
                    if (string.IsNullOrEmpty(name)) continue;
                    result[name!] = new RuleConstants
                    {
                        DegenPerSec = AsDouble(t.GetField("degeneration")?.GetValue(rule)) ?? 0,
                        FatalThreshold = AsDouble(t.GetField("fatal_threshold")?.GetValue(rule)) ?? 0,
                    };
                }
            return result;
        }

        public IEnumerable<KerbalRulesRaw> CrewRules(Vessel v)
        {
            if (_dbKerbal == null || v?.GetVesselCrew() == null) yield break;
            foreach (var c in v.GetVesselCrew())
            {
                object? kd = null;
                try { kd = _dbKerbal.Invoke(null, new object[] { c.name }); } catch { }
                var rules = new Dictionary<string, double>();
                if (kd != null)
                {
                    var rulesField = kd.GetType().GetField("rules",
                        BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance);
                    if (rulesField?.GetValue(kd) is IDictionary dict)
                        foreach (DictionaryEntry e in dict)
                        {
                            var problem = e.Value?.GetType().GetField("problem")?.GetValue(e.Value);
                            if (AsDouble(problem) is double d) rules[Convert.ToString(e.Key) ?? ""] = d;
                        }
                }
                yield return new KerbalRulesRaw { Name = c.name, Trait = c.trait, Rules = rules };
            }
        }

        // Processes + Reliability: walk part modules on the active vessel.
        // ProcessController fields resource/title/capacity/running(toggle)/broken;
        // ReliabilityInfo.BuildList(Vessel) for per-part reliability.
        // Port the DumpModules / reliability walk verbatim from GonogoDevKerbalismDump.cs.
        public IEnumerable<ProcessRaw> Processes(Vessel v) { /* see Step 3 helper port */ yield break; }
        public ReliabilityRaw? Reliability(Vessel v) => null; // filled in Task 5b

        private Type? FindType(string fullName)
        {
            if (_asm != null) { try { var t = _asm.GetType(fullName); if (t != null) return t; } catch { } }
            foreach (var a in AppDomain.CurrentDomain.GetAssemblies())
                try { var t = a.GetType(fullName); if (t != null) return t; } catch { }
            return null;
        }

        private static double? AsDouble(object? o)
        {
            if (o == null) return null;
            try { return Convert.ToDouble(o); } catch { return null; }
        }
    }

    public sealed class KerbalRulesRaw
    {
        public string Name = "";
        public string Trait = "";
        public Dictionary<string, double> Rules = new();   // rule name -> accumulator value
    }
    public struct RuleConstants
    {
        public double DegenPerSec;      // Profile.rules[].degeneration
        public double FatalThreshold;   // Profile.rules[].fatal_threshold
    }
    public sealed class ProcessRaw
    {
        public string Resource = ""; public string Title = "";
        public double Capacity; public bool Running; public bool Broken;
    }
    public sealed class ReliabilityRaw
    {
        public bool Malfunction; public bool Critical;
        public List<ReliabilityPartRaw> Parts = new();
    }
    public sealed class ReliabilityPartRaw
    {
        public string PartId = ""; public string Title = ""; public string Group = "";
        public bool Broken; public bool Critical; public double Mtbf;
        public double IgnitionsConsumed; public double DurationConsumed; public bool NeedsRepair;
    }
}
```

Note: `Processes()` and `Reliability()` bodies are completed in Task 5b once the pure mappers exist; the `ProcessRaw`/`ReliabilityRaw` shapes are fixed here so the pure test project can compile against them.

- [ ] **Step 3: Add the project to the solution**

Run: `cd mod && dotnet sln Gonogo.sln add GonogoKerbalismUplink/GonogoKerbalismUplink.csproj`
Expected: "Project ... added to the solution."

- [ ] **Step 4: Build the mod project (CI-style, with KSP managed path)**

Run: `cd mod && dotnet build GonogoKerbalismUplink/GonogoKerbalismUplink.csproj -v minimal /p:KspManaged=/Users/jon.pepler/personal/gonogo/local_docs/syncthing/kspdata/GameData/../KSP_x64_Data/Managed` (or the CI `KspManaged` value — check `mod/scripts` / another uplink's build invocation for the exact path used locally).
Expected: Build succeeded. If the KSP managed path differs, mirror whatever `build telemachus` / the existing uplink builds use.

- [ ] **Step 5: Commit**

```bash
git add mod/GonogoKerbalismUplink/ mod/Gonogo.sln
git commit -m "feat(kerbalism): reflection bridge + uplink project scaffold"
```

---

## Task 4: `KerbalismCapture` — pure mappers (headless-testable)

**Files:**
- Create: `mod/GonogoKerbalismUplink/KerbalismCapture.cs`
- Create: `mod/GonogoKerbalismUplink.Tests/GonogoKerbalismUplink.Tests.csproj`
- Create: `mod/GonogoKerbalismUplink.Tests/KerbalismCaptureTests.cs`
- Modify: `mod/Gonogo.sln`

**Interfaces:**
- Consumes: the `*Raw` structs from Task 3 + a plain `KerbalismSnapshot` input struct (all scalars, no KSP types).
- Produces: `KerbalismCapture.BuildSpaceWeather`, `BuildLifeSupport`, `BuildCrew`, `BuildFeatures`, `BuildReliabilitySummary`, `BuildReliabilityParts` — each returns a `Dictionary<string, object?>` / `List<object>` matching the Task 1 POCO shape exactly (camelCase keys). These are what `Register`'s sources publish (Task 5).

The mod publishes `Dictionary<string, object?>` value trees; the POCOs are just the typed mirror (per `ScanPayloads.cs` convention). The pure mappers take plain snapshot data and produce those dictionaries, so they unit-test with fixture JSON and zero KSP.

- [ ] **Step 1: Write the failing test (grounded in the canonical fixture)**

```csharp
// mod/GonogoKerbalismUplink.Tests/KerbalismCaptureTests.cs
using System.Collections.Generic;
using GonogoKerbalismUplink;
using Xunit;

public class KerbalismCaptureTests
{
    [Fact]
    public void BuildSpaceWeather_maps_baseline_crp_fixture()
    {
        var snap = new KerbalismSnapshot
        {
            Radiation = 3.979330252466535e-06,
            HabitatRadiation = 3.979330252466535e-06,
            Magnetosphere = true, InnerBelt = false, OuterBelt = false,
            StormIncoming = false, StormInProgress = false, Blackout = false,
            InSunlight = true,
            ShieldingAmount = 0, ShieldingCapacity = 3.308449424001643,
        };
        var sw = KerbalismCapture.BuildSpaceWeather(snap);
        Assert.Equal(3.979330252466535e-06, (double)sw["radiationRadPerSecond"]!, 12);
        Assert.Equal(true, sw["magnetosphere"]);
        Assert.Equal(false, sw["innerBelt"]);
    }

    [Fact]
    public void BuildLifeSupport_maps_food_consumable()
    {
        var snap = new KerbalismSnapshot
        {
            FoodAmount = 1.35, FoodCapacity = 1.35, FoodRate = -1.2035471250352793e-05,
        };
        var ls = KerbalismCapture.BuildLifeSupport(snap, new List<ProcessRaw>());
        var food = (Dictionary<string, object?>)ls["food"]!;
        Assert.Equal(1.35, (double)food["amount"]!, 6);
        Assert.Equal(-1.2035471250352793e-05, (double)food["rate"]!, 12);
    }

    [Fact]
    public void BuildFeatures_reports_reliability_off_under_ro()
    {
        var f = KerbalismCapture.BuildFeatures(new Dictionary<string, bool> { ["Reliability"] = false, ["Radiation"] = true });
        Assert.Equal(false, f["reliability"]);
        Assert.Equal(true, f["radiation"]);
    }

    [Fact]
    public void BuildCrew_merges_accumulator_value_with_profile_degen_constants()
    {
        var crew = new[]
        {
            new KerbalRulesRaw { Name = "Valentina Kerman", Trait = "Pilot",
                Rules = new() { ["radiation"] = 0.00014101834111076338, ["stress"] = 4.9e-05 } },
        };
        var constants = new Dictionary<string, RuleConstants>
        {
            ["radiation"] = new RuleConstants { DegenPerSec = 1.0e-05, FatalThreshold = 1.0 },
        };
        var built = KerbalismCapture.BuildCrew(crew, constants);
        var kerbal = (Dictionary<string, object?>)built[0];
        var rules = (List<object>)kerbal["rules"]!;
        var radiation = (Dictionary<string, object?>)rules[0];
        Assert.Equal("radiation", radiation["name"]);
        Assert.Equal(0.00014101834111076338, (double)radiation["value"]!, 12);
        Assert.Equal(1.0e-05, (double)radiation["degenPerSec"]!, 12);   // from Profile.rules, NOT the accumulator
        Assert.Equal(1.0, (double)radiation["fatalThreshold"]!, 6);
        // stress rule has no constant entry -> defaults to 0, never throws
        var stress = (Dictionary<string, object?>)rules[1];
        Assert.Equal(0.0, (double)stress["degenPerSec"]!, 12);
    }
}
```

- [ ] **Step 2: Write the Tests csproj (headless split)**

Copy `mod/GonogoRealAntennasUplink.Tests/GonogoRealAntennasUplink.Tests.csproj` (net10.0, xunit, `Microsoft.NET.Test.Sdk` 17.11.1). It must NOT `ProjectReference` the mod project (that needs KSP). Instead `<Compile Include="..\GonogoKerbalismUplink\KerbalismCapture.cs" />` plus the `*Raw` type file if separate. Add a `ProjectReference` to `..\..\Sitrep.Contract\Sitrep.Contract.csproj` only if a POCO is referenced by a test (not needed here — the mappers return dictionaries).

- [ ] **Step 3: Run it to verify it fails**

Run: `cd mod && dotnet test GonogoKerbalismUplink.Tests/GonogoKerbalismUplink.Tests.csproj`
Expected: FAIL to compile (`KerbalismCapture` / `KerbalismSnapshot` not defined).

- [ ] **Step 4: Write the pure mappers**

```csharp
// mod/GonogoKerbalismUplink/KerbalismCapture.cs
// Pure plain-data mappers: snapshot -> value-tree dictionaries matching the
// Sitrep.Contract Kerbalism POCOs. NO KSP/Unity/Kerbalism types.
using System.Collections.Generic;

namespace GonogoKerbalismUplink
{
    public struct KerbalismSnapshot
    {
        public double Radiation, HabitatRadiation, ShieldingAmount, ShieldingCapacity;
        public bool Magnetosphere, InnerBelt, OuterBelt, StormIncoming, StormInProgress, Blackout, InSunlight;
        public double FoodAmount, FoodCapacity, FoodRate;
        public double WaterAmount, WaterCapacity, WaterRate;
        public double OxygenAmount, OxygenCapacity, OxygenRate;
        public double EcAmount, EcCapacity, EcRate;
        public double Pressure, Poisoning, Shielding, LivingSpace, Comfort, Volume, Surface;
    }

    public static class KerbalismCapture
    {
        public static Dictionary<string, object?> BuildSpaceWeather(KerbalismSnapshot s) => new()
        {
            ["radiationRadPerSecond"] = s.Radiation,
            ["habitatRadiationRadPerSecond"] = s.HabitatRadiation,
            ["magnetosphere"] = s.Magnetosphere,
            ["innerBelt"] = s.InnerBelt,
            ["outerBelt"] = s.OuterBelt,
            ["stormIncoming"] = s.StormIncoming,
            ["stormInProgress"] = s.StormInProgress,
            ["blackout"] = s.Blackout,
            ["inSunlight"] = s.InSunlight,
            ["shieldingAmount"] = s.ShieldingAmount,
            ["shieldingCapacity"] = s.ShieldingCapacity,
        };

        private static Dictionary<string, object?> Res(double a, double c, double r) =>
            new() { ["amount"] = a, ["capacity"] = c, ["rate"] = r };

        public static Dictionary<string, object?> BuildLifeSupport(KerbalismSnapshot s, List<ProcessRaw> processes)
        {
            var procs = new List<object>();
            foreach (var p in processes)
                procs.Add(new Dictionary<string, object?>
                {
                    ["resource"] = p.Resource, ["title"] = p.Title, ["capacity"] = p.Capacity,
                    ["running"] = p.Running, ["broken"] = p.Broken,
                });
            return new Dictionary<string, object?>
            {
                ["food"] = Res(s.FoodAmount, s.FoodCapacity, s.FoodRate),
                ["water"] = Res(s.WaterAmount, s.WaterCapacity, s.WaterRate),
                ["oxygen"] = Res(s.OxygenAmount, s.OxygenCapacity, s.OxygenRate),
                ["electricCharge"] = Res(s.EcAmount, s.EcCapacity, s.EcRate),
                ["habitat"] = new Dictionary<string, object?>
                {
                    ["pressure"] = s.Pressure, ["poisoning"] = s.Poisoning, ["shielding"] = s.Shielding,
                    ["livingSpace"] = s.LivingSpace, ["comfort"] = s.Comfort,
                    ["volume"] = s.Volume, ["surface"] = s.Surface,
                },
                ["processes"] = procs,
            };
        }

        public static List<object> BuildCrew(
            IEnumerable<KerbalRulesRaw> crew,
            IReadOnlyDictionary<string, RuleConstants> constants)
        {
            var list = new List<object>();
            foreach (var k in crew)
            {
                var rules = new List<object>();
                foreach (var kv in k.Rules)
                {
                    constants.TryGetValue(kv.Key, out var c);   // default (0,0) when unknown
                    rules.Add(new Dictionary<string, object?>
                    {
                        ["name"] = kv.Key,
                        ["value"] = kv.Value,
                        ["degenPerSec"] = c.DegenPerSec,
                        ["fatalThreshold"] = c.FatalThreshold,
                    });
                }
                list.Add(new Dictionary<string, object?>
                {
                    ["name"] = k.Name, ["trait"] = k.Trait,
                    ["rules"] = rules,
                    // deathClockSec: null until rule->resource linkage is confirmed; the client derives
                    // stage-1 (resource time-to-empty from kerbalism.lifesupport) + stage-2 (this rule's
                    // (fatalThreshold - value)/degenPerSec). Fold a mod-side computation here later if wanted.
                    ["deathClockSec"] = null,
                });
            }
            return list;
        }

        public static Dictionary<string, object?> BuildFeatures(IReadOnlyDictionary<string, bool> f)
        {
            bool G(string k) => f.TryGetValue(k, out var v) && v;
            return new Dictionary<string, object?>
            {
                ["reliability"] = G("Reliability"), ["radiation"] = G("Radiation"),
                ["spaceWeather"] = G("SpaceWeather"), ["shielding"] = G("Shielding"),
                ["livingSpace"] = G("LivingSpace"), ["comfort"] = G("Comfort"),
                ["poisoning"] = G("Poisoning"), ["pressure"] = G("Pressure"),
                ["habitat"] = G("Habitat"), ["supplies"] = G("Supplies"),
                ["science"] = G("Science"), ["automation"] = G("Automation"), ["deploy"] = G("Deploy"),
            };
        }

        public static Dictionary<string, object?> BuildReliabilitySummary(bool unmodeled, bool malfunction, bool critical, string source) => new()
        {
            ["unmodeled"] = unmodeled, ["malfunction"] = malfunction, ["critical"] = critical, ["source"] = source,
        };

        public static List<object> BuildReliabilityParts(IEnumerable<ReliabilityPartRaw> parts)
        {
            var list = new List<object>();
            foreach (var p in parts)
                list.Add(new Dictionary<string, object?>
                {
                    ["partId"] = p.PartId, ["title"] = p.Title, ["group"] = p.Group,
                    ["broken"] = p.Broken, ["critical"] = p.Critical, ["mtbfHours"] = p.Mtbf,
                    ["ignitionsConsumed"] = p.IgnitionsConsumed, ["durationConsumed"] = p.DurationConsumed,
                    ["needsRepair"] = p.NeedsRepair,
                });
            return list;
        }
    }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd mod && dotnet test GonogoKerbalismUplink.Tests/GonogoKerbalismUplink.Tests.csproj`
Expected: PASS (3 tests).

- [ ] **Step 6: Add the Tests project to the solution and commit**

```bash
cd mod && dotnet sln Gonogo.sln add GonogoKerbalismUplink.Tests/GonogoKerbalismUplink.Tests.csproj && cd ..
git add mod/GonogoKerbalismUplink/KerbalismCapture.cs mod/GonogoKerbalismUplink.Tests/ mod/Gonogo.sln
git commit -m "feat(kerbalism): pure capture mappers + headless tests against baseline-crp fixture"
```

---

## Task 5: `KerbalismUplink` — manifest, sources, health

**Files:**
- Create: `mod/GonogoKerbalismUplink/KerbalismUplink.cs`
- Modify: `mod/GonogoKerbalismUplink/KerbalismReflection.cs` (fill in `Processes` + `Reliability`, Task 5b)

**Interfaces:**
- Consumes: `KerbalismReflection` (Task 3), `KerbalismCapture` (Task 4), the `IUplinkHost` seams (`AddChannelSource`, `Publisher`, `AddSampledSource`) and `ISitrepUplink`/`UplinkManifest`/`ChannelDeclaration`/`EmissionPolicy`/`DelayRole` from `Sitrep.Contract`.
- Produces: the `[SitrepUplink("kerbalism")]` uplink discovered automatically at KSP load. Emits `kerbalism.available` (TrueNow bool), `kerbalism.features` (TrueNow), `kerbalism.spaceweather`/`kerbalism.lifesupport`/`kerbalism.crew` (Delayed). Reliability topics come in Task 6.

Follow `mod/GonogoRealAntennasUplink/RealAntennasUplink.cs` for structure: reflection bridge in the ctor, a `TrueNow(topic)` helper for presence/ground-fact channels, `AddSampledSource(captureOnMain, handleOnCourier, topicPrefix)` for the vessel telemetry (KSP reads on the main thread, publish off-thread).

- [ ] **Step 1: Write the uplink class**

```csharp
// mod/GonogoKerbalismUplink/KerbalismUplink.cs
using System.Collections.Generic;
using Sitrep.Contract;

namespace GonogoKerbalismUplink
{
    [SitrepUplink("kerbalism")]
    public sealed class KerbalismUplink : ISitrepUplink
    {
        private const string AvailableTopic = "kerbalism.available";
        private const string FeaturesTopic = "kerbalism.features";
        private const string SpaceWeatherTopic = "kerbalism.spaceweather";
        private const string LifeSupportTopic = "kerbalism.lifesupport";
        private const string CrewTopic = "kerbalism.crew";

        private readonly KerbalismReflection _k = new();

        public UplinkManifest Manifest { get; }

        public KerbalismUplink()
        {
            Manifest = new UplinkManifest
            {
                Id = "kerbalism",
                Version = "1.0.0",
                Channels = new List<ChannelDeclaration>
                {
                    Presence(AvailableTopic),
                    Presence(FeaturesTopic),
                    Delayed(SpaceWeatherTopic),
                    Delayed(LifeSupportTopic),
                    Delayed(CrewTopic),
                },
            };
        }

        private static ChannelDeclaration Presence(string topic) => new()
        {
            Topic = topic, Delivery = Delivery.LossyLatest,
            Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
            Delay = DelayRole.TrueNow,
        };

        private static ChannelDeclaration Delayed(string topic) => new()
        {
            Topic = topic, Delivery = Delivery.LossyLatest,
            Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
            Delay = DelayRole.Delayed,
        };

        public void Register(IUplinkHost host)
        {
            host.AddChannelSource(AvailableTopic, _ => _k.IsAvailable);
            host.AddChannelSource(FeaturesTopic, _ => _k.IsAvailable
                ? KerbalismCapture.BuildFeatures(_k.Features()) : null);

            var swPub = host.Publisher(SpaceWeatherTopic);
            var lsPub = host.Publisher(LifeSupportTopic);
            var crewPub = host.Publisher(CrewTopic);

            host.AddSampledSource(
                captureOnMainThread: snap => CaptureOnMain(snap),
                handleOnCourier: (captured, ut) => HandleOnCourier(captured, ut, swPub, lsPub, crewPub),
                subscriptionTopicPrefixes: new[] { SpaceWeatherTopic, LifeSupportTopic, CrewTopic });
        }

        // Runs on the Unity main thread. Reads live Kerbalism via reflection into a plain payload.
        private object? CaptureOnMain(KspSnapshot snap)
        {
            var v = snap?.ActiveVessel;   // [verify] exact accessor name on KspSnapshot; mirror RealAntennasUplink.CaptureOnMain
            if (v == null || !_k.IsAvailable) return null;
            var s = new KerbalismSnapshot
            {
                Radiation = _k.Api("Radiation", v) ?? 0,
                HabitatRadiation = _k.Api("HabitatRadiation", v) ?? 0,
                Magnetosphere = _k.ApiBool("Magnetosphere", v) ?? false,
                InnerBelt = _k.ApiBool("InnerBelt", v) ?? false,
                OuterBelt = _k.ApiBool("OuterBelt", v) ?? false,
                StormIncoming = _k.ApiBool("StormIncoming", v) ?? false,
                StormInProgress = _k.ApiBool("StormInProgress", v) ?? false,
                Blackout = _k.ApiBool("Blackout", v) ?? false,
                InSunlight = _k.ApiBool("InSunlight", v) ?? false,
                ShieldingAmount = _k.ApiResource("ResourceAmount", v, "Shielding") ?? 0,
                ShieldingCapacity = _k.ApiResource("ResourceCapacity", v, "Shielding") ?? 0,
                FoodAmount = _k.ApiResource("ResourceAmount", v, "Food") ?? 0,
                FoodCapacity = _k.ApiResource("ResourceCapacity", v, "Food") ?? 0,
                FoodRate = _k.ApiResource("ResourceAverageRate", v, "Food") ?? 0,
                WaterAmount = _k.ApiResource("ResourceAmount", v, "Water") ?? 0,
                WaterCapacity = _k.ApiResource("ResourceCapacity", v, "Water") ?? 0,
                WaterRate = _k.ApiResource("ResourceAverageRate", v, "Water") ?? 0,
                OxygenAmount = _k.ApiResource("ResourceAmount", v, "Oxygen") ?? 0,
                OxygenCapacity = _k.ApiResource("ResourceCapacity", v, "Oxygen") ?? 0,
                OxygenRate = _k.ApiResource("ResourceAverageRate", v, "Oxygen") ?? 0,
                EcAmount = _k.ApiResource("ResourceAmount", v, "ElectricCharge") ?? 0,
                EcCapacity = _k.ApiResource("ResourceCapacity", v, "ElectricCharge") ?? 0,
                EcRate = _k.ApiResource("ResourceAverageRate", v, "ElectricCharge") ?? 0,
                Pressure = _k.Api("Pressure", v) ?? 0,
                Poisoning = _k.Api("Poisoning", v) ?? 0,
                Shielding = _k.Api("Shielding", v) ?? 0,
                LivingSpace = _k.Api("LivingSpace", v) ?? 0,
                Comfort = _k.Api("Comfort", v) ?? 0,
                Volume = _k.Api("Volume", v) ?? 0,
                Surface = _k.Api("Surface", v) ?? 0,
            };
            var processes = new List<ProcessRaw>(_k.Processes(v));
            var crew = new List<KerbalRulesRaw>(_k.CrewRules(v));
            // Profile.rules constants are static (vessel-independent); reflect them here so the pure
            // mapper stays KSP-free. Cheap dictionary — resolved-once inside RuleConstants().
            var ruleConstants = _k.RuleConstants();
            return new KerbalismCaptured { Snapshot = s, Processes = processes, Crew = crew, RuleConstants = ruleConstants };
        }

        private void HandleOnCourier(object? captured, double ut,
            IChannelPublisher swPub, IChannelPublisher lsPub, IChannelPublisher crewPub)
        {
            if (captured is not KerbalismCaptured c) return;
            swPub.Publish(KerbalismCapture.BuildSpaceWeather(c.Snapshot), ut);
            lsPub.Publish(KerbalismCapture.BuildLifeSupport(c.Snapshot, c.Processes), ut);
            crewPub.Publish(KerbalismCapture.BuildCrew(c.Crew, c.RuleConstants), ut);
        }

        public UplinkHealth Health() =>
            _k.IsAvailable ? UplinkHealth.Healthy : UplinkHealth.Unavailable("Kerbalism assembly not loaded");
    }

    internal sealed class KerbalismCaptured
    {
        public KerbalismSnapshot Snapshot;
        public List<ProcessRaw> Processes = new();
        public List<KerbalRulesRaw> Crew = new();
        public IReadOnlyDictionary<string, RuleConstants> RuleConstants = new Dictionary<string, RuleConstants>();
    }
}
```

- [ ] **Step 2: (Task 5b) Fill in `KerbalismReflection.Processes` + `Reliability`**

Port `DumpModules(..., "ProcessController")` from `GonogoDevKerbalismDump.cs` into `Processes(Vessel v)`: walk `v.parts` → `part.Modules` → modules whose `GetType().Name == "ProcessController"`, read fields `resource`/`title`/`capacity`/`toggle`(→running)/`broken`. Port the reliability walk: resolve `ReliabilityInfo` type, call `BuildList(Vessel)` (static), read each entry's `title/group/broken/critical/partId/mtbf/rel_duration/rel_ignitions` + `NeedsMaintenance()`. Set `Reliability()` to return a `ReliabilityRaw` with `Malfunction = ApiBool("Malfunction", v)`, `Critical = ApiBool("Critical", v)`, and the parts list. Mark the exact `ReliabilityInfo` FQN **[fixture-confirm]** against a live capture (the baseline fixture only proves the vessel-level bools).

- [ ] **Step 3: Build the mod project**

Run: `cd mod && dotnet build GonogoKerbalismUplink/GonogoKerbalismUplink.csproj -v minimal /p:KspManaged=<ksp-managed-path>`
Expected: Build succeeded. `KspSnapshot`/`IChannelPublisher`/`IUplinkHost` member names must match `Sitrep.Contract/UplinkContract.cs` — if `snap.ActiveVessel` or `AddSampledSource`'s signature differs, align with `mod/GonogoRealAntennasUplink/RealAntennasUplink.cs` (the reference sampled-source consumer) and fix.

- [ ] **Step 4: Commit**

```bash
git add mod/GonogoKerbalismUplink/KerbalismUplink.cs mod/GonogoKerbalismUplink/KerbalismReflection.cs
git commit -m "feat(kerbalism): uplink class emitting spaceweather, lifesupport, crew, features"
```

---

## Task 6: Reliability via the Kernel `reliability` capability

**Files:**
- Modify: `mod/GonogoKerbalismUplink/KerbalismUplink.cs` (implement `IUplinkCapabilityDeclarer` + publish reliability when elected)

**Interfaces:**
- Consumes: the Kernel capability API (`IUplinkCapabilityDeclarer.DeclareCapabilities(Kernel)`, `ctx.Query<T>(...)`) — study the comms precedent in `mod/GonogoRealAntennasUplink/RealAntennasUplink.cs:104-110` + `CommsCoreUplink` (`mod/Gonogo.KSP/`) for the EXACT registration/election API.
- Produces: `reliability.summary` + `reliability.parts` topics published by whichever provider the Kernel elects. Kerbalism registers a LOW-specificity provider (`unmodeled = !Features.Reliability`); `TestFlightUplink` registers a HIGH-specificity provider (`2026-07-22-testflight-uplink.md`). Under RO only TestFlight is live; in stock Kerbalism only Kerbalism is live; the pathological both-on case resolves by specificity in the Kernel, not in the client.

- [ ] **Step 1: Declare the capability + add the reliability channels**

Add `reliability.summary` (Delayed) + `reliability.parts` (Delayed) to the manifest. Implement `IUplinkCapabilityDeclarer`:

```csharp
public sealed class KerbalismUplink : ISitrepUplink, IUplinkCapabilityDeclarer
{
    // ...existing...
    public void DeclareCapabilities(Kernel kernel)
    {
        // Low-specificity reliability provider — the fallback. TestFlight outranks this.
        // API shape mirrors the "comms" capability: see RealAntennasUplink.DeclareCapabilities /
        // CommsCoreUplink. Register only when Kerbalism is present.
        if (_k.IsAvailable)
            kernel.Provide<IReliabilityProvider>("reliability", new KerbalismReliabilityProvider(_k), specificity: 1);
    }
}
```

Define `IReliabilityProvider` in `Sitrep.Contract` (a capability interface, NOT a wire type — model it on `ICommsBackend` in `mod/Sitrep.Contract/Comms.cs`):

```csharp
public interface IReliabilityProvider
{
    bool IsModeled { get; }         // false when Features.Reliability off
    object? Summary(Vessel v);      // dict matching ReliabilitySummary
    object? Parts(Vessel v);        // list matching ReliabilityPartEntry[]
}
```

- [ ] **Step 2: Wire the elected provider's topic sources in `Register`**

In `Register`, query the elected provider and publish from it (so only ONE reliability source is live):

```csharp
var reliability = host.QueryCapability<IReliabilityProvider>("reliability"); // [verify] exact host query method
if (reliability != null)
{
    host.AddSampledSource(
        captureOnMainThread: snap => snap?.ActiveVessel is Vessel rv
            ? new object?[] { reliability.Summary(rv), reliability.Parts(rv) } : null,
        handleOnCourier: (cap, ut) => { if (cap is object?[] a) { relSummaryPub.Publish(a[0], ut); relPartsPub.Publish(a[1], ut); } },
        subscriptionTopicPrefixes: new[] { "reliability.summary", "reliability.parts" });
}
```

Note: whether the elected provider's topics are published by the ELECTING uplink or by the winner directly depends on the capability API — resolve against the comms precedent (does `CommsCoreUplink` publish `comms.*` for whichever backend won, or does the backend publish?). Mirror exactly whatever comms does; the design intent is "one reliability topic, no client choice, Kerbalism yields to TestFlight".

- [ ] **Step 3: Build + confirm the contract has `IReliabilityProvider`**

Run: `cd mod && dotnet build GonogoKerbalismUplink/GonogoKerbalismUplink.csproj -v minimal /p:KspManaged=<path>`
Expected: Build succeeded.

- [ ] **Step 4: Commit**

```bash
git add mod/GonogoKerbalismUplink/KerbalismUplink.cs mod/Sitrep.Contract/Comms.cs mod/Sitrep.Contract/KerbalismPayloads.cs
git commit -m "feat(kerbalism): reliability via Kernel capability (yields to TestFlight under RO)"
```

---

## Task 7: Scaffold the `@ksp-gonogo/kerbalism` client package

**Files:**
- Create: `mod/GonogoKerbalismUplink/client/package.json`
- Create: `mod/GonogoKerbalismUplink/client/tsconfig.json`
- Create: `mod/GonogoKerbalismUplink/client/vitest.config.ts`
- Create: `mod/GonogoKerbalismUplink/client/src/index.ts`
- Create: `mod/GonogoKerbalismUplink/client/src/topics.ts`

**Interfaces:**
- Produces: workspace package `@ksp-gonogo/kerbalism` (picked up by the `mod/*/client` glob in `pnpm-workspace.yaml`); registers the bare-primitive topic `kerbalism.available`.

- [ ] **Step 1: Copy the scaffold from scansat**

Copy `mod/GonogoScansatUplink/client/{package.json,tsconfig.json,vitest.config.ts}`. In `package.json` set `"name": "@ksp-gonogo/kerbalism"`, `"license": "MIT"` (reflection-only mod → MIT client is fine; match the mod's license expression), keep the `@ksp-gonogo/{core,components,data,ui,ui-kit}` deps + `styled-components` + the sitrep-sdk/test-utils devDeps.

- [ ] **Step 2: Declare the bare-primitive presence topic**

```ts
// mod/GonogoKerbalismUplink/client/src/topics.ts
import { registerBarePrimitiveTopic } from "@ksp-gonogo/sitrep-sdk";

declare module "@ksp-gonogo/sitrep-sdk" {
  interface TopicPayloadMap {
    "kerbalism.available": boolean;
  }
}

registerBarePrimitiveTopic("kerbalism.available");
```

- [ ] **Step 3: Write the registration entry (bare side-effect imports)**

```ts
// mod/GonogoKerbalismUplink/client/src/index.ts
import "./topics";
import "./SpaceWeather";
import "./LifeSupportSystems";

export { SpaceWeatherComponent } from "./SpaceWeather";
export { LifeSupportSystemsComponent } from "./LifeSupportSystems";
```

- [ ] **Step 4: Install + typecheck the new package**

Run: `pnpm install && pnpm --filter @ksp-gonogo/kerbalism typecheck`
Expected: install adds the package to the workspace; typecheck FAILS on the missing `./SpaceWeather` / `./LifeSupportSystems` (created in Tasks 8-9) — that is expected at this step; confirm it is ONLY those missing-module errors.

- [ ] **Step 5: Commit**

```bash
git add mod/GonogoKerbalismUplink/client/ pnpm-lock.yaml
git commit -m "feat(kerbalism): scaffold @ksp-gonogo/kerbalism client package"
```

---

## Task 8: Move + rewire the SpaceWeather widget to `useTelemetry`

**Files:**
- Create: `mod/GonogoKerbalismUplink/client/src/SpaceWeather/index.tsx` (moved from `packages/components/src/SpaceWeather/index.tsx`)
- Create: `mod/GonogoKerbalismUplink/client/src/SpaceWeather/index.test.tsx` (moved)
- Create: `mod/GonogoKerbalismUplink/client/src/SpaceWeather/__fixtures__/*.json` (moved)
- Delete: `packages/components/src/SpaceWeather/` (the whole dir)
- Modify: `packages/components/src/index.ts` (drop the SpaceWeather export)
- Modify: `packages/components/scripts/widgets.ts` (drop the SpaceWeather probe entry — or move it to the package's own visual harness config)

**Interfaces:**
- Consumes: `useTelemetry("kerbalism.spaceweather")` → `KerbalismSpaceWeather | undefined` (from the SDK, Task 2).
- Produces: the `space-weather` component, now registered from `@ksp-gonogo/kerbalism`, reading the real Topic. The presentation (`SpaceWeatherData` interface + all SVG rendering) is UNCHANGED — only the data hook boundary moves.

The widget was authored with this exact seam (its own comment: "When the real KerbalismUplink Topic lands, swap `useSpaceWeather` to read `useTelemetry('spaceweather')`; the presentation below never changes — this hook is the data boundary"). This task cashes that in.

- [ ] **Step 1: Move the widget files**

```bash
git mv packages/components/src/SpaceWeather mod/GonogoKerbalismUplink/client/src/SpaceWeather
```
Update imports inside `index.tsx` + `index.test.tsx` to pull framework surface from `@ksp-gonogo/sitrep-sdk` instead of `@ksp-gonogo/core` (`registerComponent`, `ComponentProps`), and presentation from `@ksp-gonogo/ui-kit` (the widget currently imports `Meter, Panel, ...` from `@ksp-gonogo/ui` — keep `Meter` from `@ksp-gonogo/ui` if that is where it lives, else map to ui-kit's `ProgressBar`; check `packages/ui/src/index.ts` vs `packages/ui-kit/src/index.ts` and use whichever exports `Meter`).

- [ ] **Step 2: Rewrite `useSpaceWeather` to read the Topic (write the failing test first)**

Add to the moved `index.test.tsx` a test that mounts the widget with a fake `kerbalism` telemetry value and asserts the rendered radiation readout. Use the established fake-source pattern (a `TelemetryClient`/registry fake — see `mod/GonogoScansatUplink/client/src/Scanning/index.test.tsx` for the reusable fake), NOT `vi.mock`.

```tsx
it("renders radiation from the kerbalism.spaceweather Topic", async () => {
  renderWithTelemetry(<SpaceWeatherComponent {...baseProps} />, {
    topics: { "kerbalism.spaceweather": {
      radiationRadPerSecond: 3.979e-06, magnetosphere: true, innerBelt: false, outerBelt: false,
      stormIncoming: false, stormInProgress: false, blackout: false, inSunlight: true,
      shieldingAmount: 0, shieldingCapacity: 3.31,
    } },
  });
  // 3.979e-06 rad/s * 3600 = 0.0143 rad/h
  expect(await screen.findByText(/0\.014/)).toBeInTheDocument();
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm --filter @ksp-gonogo/kerbalism test -- SpaceWeather`
Expected: FAIL (still reading `sw.*` flat keys).

- [ ] **Step 4: Swap the data hook**

Replace the `useRaw`/`useNum`/`useBool` `sw.*` reads with a single Topic read + client-side derivation. Keep the `SpaceWeatherData` shape identical so the rest of the file is untouched:

```tsx
import { useTelemetry } from "@ksp-gonogo/sitrep-sdk";
import type { KerbalismSpaceWeather } from "@ksp-gonogo/sitrep-sdk";

function useSpaceWeather(): SpaceWeatherData {
  const t = useTelemetry("kerbalism.spaceweather") as KerbalismSpaceWeather | undefined;
  const stormState: StormState = t?.stormInProgress ? "inprogress" : t?.stormIncoming ? "incoming" : "none";
  return {
    radiationRadPerHour: (t?.radiationRadPerSecond ?? 0) * 3600, // [fixture-confirm] units
    stormState,
    stormTimeSec: null,           // API exposes no storm clock; client-derived/synthetic (see spaceweather-widget-SPEC.md)
    innerBelt: t?.innerBelt ?? false,
    outerBelt: t?.outerBelt ?? false,
    magnetosphere: t?.magnetosphere ?? false,
    blackout: t?.blackout ?? false,
    shieldingValue: t?.shieldingAmount ?? 0,
    shieldingCapacity: t?.shieldingCapacity ?? 0,
    altitudeKm: (useTelemetry("vessel.state") as { altitude?: number } | undefined)?.altitude ?? 0 / 1000, // [verify] altitude topic/field
    seed: Math.floor((useTelemetry("vessel.state") as { ut?: number } | undefined)?.ut ?? 0),               // [verify] UT source for deterministic noise
  };
}
```

Update `registerComponent`: move `dataRequirements: ["sw.*", ...]` to `channels: ["kerbalism.spaceweather"]` + `optionalChannels: ["vessel.state"]` (whatever the real altitude/UT topic is — confirm against the SDK `TopicId` union); keep `id: "space-weather"`, `requires: ["flight"]`.

- [ ] **Step 5: Run tests + typecheck to verify pass**

Run: `pnpm --filter @ksp-gonogo/kerbalism test && pnpm --filter @ksp-gonogo/kerbalism typecheck`
Expected: PASS (including the retained synthetic-fixture snapshot tests + `jest-axe`).

- [ ] **Step 6: Drop the stale component-package wiring**

Remove the `SpaceWeather` export from `packages/components/src/index.ts` and its probe entry from `packages/components/scripts/widgets.ts`. Run `pnpm --filter @ksp-gonogo/components typecheck` — expect PASS.

- [ ] **Step 7: Commit**

```bash
git add mod/GonogoKerbalismUplink/client/src/SpaceWeather/ packages/components/src/index.ts packages/components/scripts/widgets.ts
git commit -m "feat(kerbalism): SpaceWeather reads kerbalism.spaceweather Topic; move out of components"
```

---

## Task 9: Move + rewire the LifeSupportSystems widget to `useTelemetry`

**Files:**
- Create: `mod/GonogoKerbalismUplink/client/src/LifeSupportSystems/*` (moved from `packages/components/src/LifeSupportSystems/`)
- Delete: `packages/components/src/LifeSupportSystems/`
- Modify: `packages/components/src/index.ts`, `packages/components/scripts/widgets.ts`

**Interfaces:**
- Consumes: `useTelemetry("kerbalism.lifesupport")` → `KerbalismLifeSupport | undefined`.
- Produces: the `life-support` component registered from `@ksp-gonogo/kerbalism`. The `LifeSupportData` presentation shape is unchanged.

- [ ] **Step 1: Move the files** (same `git mv` + import-rewrite as Task 8 Step 1)

- [ ] **Step 2: Write the failing Topic test**

```tsx
it("renders the food ledger from kerbalism.lifesupport", async () => {
  renderWithTelemetry(<LifeSupportSystemsComponent {...baseProps} />, {
    topics: { "kerbalism.lifesupport": {
      food: { amount: 1.35, capacity: 1.35, rate: -1.2e-05 },
      water: { amount: 0.7, capacity: 0.7, rate: -6.2e-06 },
      oxygen: { amount: 186.9, capacity: 187, rate: -1.7e-03 },
      electricCharge: { amount: 446.7, capacity: 450, rate: -0.089 },
      habitat: { pressure: 0, poisoning: 0, shielding: 0, livingSpace: 0.1, comfort: 0.3, volume: 0.798, surface: 3.31 },
      processes: [
        { resource: "_Scrubber", title: "Scrubber", capacity: 1.67, running: true, broken: false },
        { resource: "_WaterRecycler", title: "Water recycler", capacity: 1.67, running: true, broken: false },
      ],
    } },
  });
  expect(await screen.findByText("Scrubber")).toBeInTheDocument();
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm --filter @ksp-gonogo/kerbalism test -- LifeSupport`
Expected: FAIL.

- [ ] **Step 4: Swap the data hook**

Replace all `ls.*` reads with one Topic read; map the process array to the widget's `ProcessRow` by matching known titles, deriving `state` (broken → "broken", running → "running", else "idle"). Keep `LifeSupportData` identical:

```tsx
import { useTelemetry } from "@ksp-gonogo/sitrep-sdk";
import type { KerbalismLifeSupport } from "@ksp-gonogo/sitrep-sdk";

function useLifeSupport(): LifeSupportData {
  const t = useTelemetry("kerbalism.lifesupport") as KerbalismLifeSupport | undefined;
  const cons = (r?: { amount?: number; capacity?: number; rate?: number }): Consumable =>
    ({ amount: r?.amount ?? 0, capacity: r?.capacity ?? 0, rate: r?.rate ?? 0 });
  const processes: ProcessRow[] = (t?.processes ?? []).map((p) => ({
    id: p.resource ?? "", name: p.title ?? "",
    state: p.broken ? "broken" : p.running ? "running" : "idle",
  }));
  return {
    food: cons(t?.food), water: cons(t?.water), oxygen: cons(t?.oxygen), ec: cons(t?.electricCharge),
    pressurized: (t?.habitat?.pressure ?? 0) > 0.5,
    co2Poisoning: t?.habitat?.poisoning ?? 0,
    comfort: t?.habitat?.comfort ?? 0,
    livingSpace: t?.habitat?.livingSpace ?? 0,
    climatization: 0, // per-kerbal → kerbalism.crew; vessel LS widget shows 0 unless a representative value is folded in later
    processes,
  };
}
```

Update `registerComponent`: `channels: ["kerbalism.lifesupport"]`, drop `dataRequirements: ["ls.*"]`, keep `id: "life-support"`, `requires: ["flight"]`.

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm --filter @ksp-gonogo/kerbalism test && pnpm --filter @ksp-gonogo/kerbalism typecheck`
Expected: PASS.

- [ ] **Step 6: Drop stale wiring + commit**

```bash
git add mod/GonogoKerbalismUplink/client/src/LifeSupportSystems/ packages/components/src/index.ts packages/components/scripts/widgets.ts
git commit -m "feat(kerbalism): LifeSupportSystems reads kerbalism.lifesupport Topic; move out of components"
```

---

## Task 10: App wiring + legacy map-topic fallback

**Files:**
- Modify: `packages/app/src/main.tsx` (dynamic-import the package)
- Modify: `packages/app/package.json` (add `@ksp-gonogo/kerbalism` dep)
- Modify: `packages/sitrep-client/src/map-topic.ts` (legacy `sw.*`/`ls.*` → Topic fallback entries)
- Modify (if the coverage gate flags them): `packages/core/src/hooks/mapTopic.coverage.test.ts`

**Interfaces:**
- Consumes: the registered widgets from Tasks 8-9.
- Produces: the widgets mount in the running app; any lingering legacy `sw.*`/`ls.*` reader falls back correctly during the migration window.

- [ ] **Step 1: Dynamic-import the uplink in the app bootstrap**

In `packages/app/src/main.tsx`, alongside `import("@ksp-gonogo/scansat")` etc., add `import("@ksp-gonogo/kerbalism");`. Add `"@ksp-gonogo/kerbalism": "workspace:*"` to `packages/app/package.json` dependencies.

- [ ] **Step 2: Add map-topic entries (only if a legacy reader still exists)**

The migrated widgets read canonical Topics directly, so this is belt-and-braces for any remaining `("data", "sw.*"/"ls.*")` reader. If the coverage test `packages/core/src/hooks/mapTopic.coverage.test.ts` lists `sw.*`/`ls.*` keys as unmapped, either map them to the new Topic or add them to the documented gap list — do NOT leave the gate red.

- [ ] **Step 3: Typecheck + run the app-side + core suites**

Run: `pnpm install && pnpm --filter @ksp-gonogo/app typecheck && pnpm --filter @ksp-gonogo/core test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/app/src/main.tsx packages/app/package.json packages/sitrep-client/src/map-topic.ts packages/core/src/hooks/mapTopic.coverage.test.ts pnpm-lock.yaml
git commit -m "feat(kerbalism): wire @ksp-gonogo/kerbalism into the app + legacy topic fallback"
```

---

## Task 11: Full-suite gate + visual baselines

**Files:** none (verification task)

- [ ] **Step 1: Run the full uncached suite**

Run: `pnpm build && pnpm test` (or `turbo run test --force --continue` per the repo's full-suite discipline — codegen-regen + cross-package ratchets are only caught uncached).
Expected: all packages green, including `@ksp-gonogo/kerbalism`, `@ksp-gonogo/components`, `@ksp-gonogo/sitrep-sdk`, `@ksp-gonogo/core`.

- [ ] **Step 2: Regenerate visual baselines for the moved widgets**

The two widgets moved packages; their probe/visual entries moved too. If the `visual` job baselines were keyed under `components`, regenerate on Linux CI: `gh workflow run update-baselines.yml --ref <branch> -f widget=space-weather` and `-f widget=life-support`. Do NOT commit macOS-rendered baselines.

- [ ] **Step 3: Final commit (if baseline paths moved in-repo)**

```bash
git add packages/components/visual-baselines mod/GonogoKerbalismUplink/client
git commit -m "test(kerbalism): relocate visual baselines for migrated widgets"
```

---

## Self-Review

- **Spec coverage:** mod-side uplink emitting proven Kerbalism data (Tasks 3-6: spaceweather, lifesupport, habitat, processes, crew, features, reliability) ✓; client Topics in the SDK (Tasks 1-2) ✓; SpaceWeather + LifeSupport read `useTelemetry` (Tasks 8-9) ✓; map-topic wiring (Task 10) ✓; presence-gated (`kerbalism.available`, Task 5/7) ✓; mandatory health (Task 5) ✓; delay-gated (Delayed vs TrueNow per topic, Task 5) ✓; per-kerbal dose not deferred (Task 4/5 crew) ✓; per-rule degeneration rate + fatal threshold from `Profile.rules` for the two-stage death-clock (main's requirement, Tasks 1/3/4/5) ✓; reflection grounded in the proven dump tool ✓; every Value traced to `baseline-crp` fixture ✓.
- **VERIFY tags** are confined to genuinely un-captured data (radiation units, storm clock, `ReliabilityInfo` FQN, `KspSnapshot.ActiveVessel`/host-query member names) — resolve each against a live Deck capture or the cited reference file before locking, consistent with the DECISIONS "Still-VERIFY" list.
- **Type consistency:** Topic ids, POCO field names (camelCase), and the client mappers all agree (`radiationRadPerSecond` emitted → `*3600` in client; `processes[].resource/title/running/broken` emitted → mapped to `ProcessRow`).
- **Open coordination:** the reliability capability API surface (`Provide`/`QueryCapability`/publisher ownership) MUST be reconciled with the comms precedent during Task 6 and kept in lock-step with `2026-07-22-testflight-uplink.md`.
