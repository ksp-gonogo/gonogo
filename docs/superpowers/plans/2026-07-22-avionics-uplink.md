# GonogoAvionicsUplink Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `GonogoAvionicsUplink` — a reflection-only C# Sitrep uplink that publishes RP-1 avionics controllability state (`avionics.status` Topic), plus a compact `@ksp-gonogo/avionics` client widget that renders the ascent go/no-go: is the vessel's current mass within the active avionics unit's controllable-mass (tonnage) limit.

**Architecture:** RP-1 gates vehicle control by an avionics unit's tonnage limit — if the vessel's mass exceeds the controllable mass of its active avionics, the craft cannot be steered during ascent. This uplink reflects the RP-1 avionics part modules (`ModuleAvionics` / `ModuleProceduralAvionics` in the RP-0/RP-1 plugin) for the controllable-mass limit and compares it to the vessel's current mass, emitting a single `avionics.status` Topic. One Domain `avionics`, one uplink `[SitrepUplink("avionics")]`, zero compile-time link (reflection helper mirroring `RaReflection.cs`). The uplink OWNS a small client widget (`@ksp-gonogo/avionics`, a compact GO/NO-GO readout) because this is a first-class operator surface, not a cross-Domain augment into an existing widget.

**Tech Stack:** C# net48 (mod) / net10.0 (mod tests, xunit) reflecting over the RP-0/RP-1 plugin; TypeScript + React 18 + styled-components + Vitest + jest-axe (client, `@ksp-gonogo/avionics`).

## Global Constraints

- Work ONLY in your own worktree on a NEW branch off **staging**; verify `git branch --show-current` before starting
- Commit locally, NEVER push; author as a human (no AI attribution trailer, no trailing periods on bullets, no em-dashes)
- Pre-commit runs biome + cross-package typecheck; if it fails, read + fix, re-commit; NEVER `--no-verify`
- Vocabulary: **Domain** (`avionics`) / **Topic** (`avionics.status`) / **Value**; say "Topic" not "channel"
- No Uplink talks to another
- Reflection-only: MIT license expression; no RP-0/RP-1 plugin compile reference
- `Health()` mandatory; `Unavailable("RP-1 avionics assembly not loaded")` when absent
- Presence-gate with `avionics.available` (`DelayRole.TrueNow`, bare boolean); the status Topic is `DelayRole.Delayed`
- New structured Topic → `[SitrepTopic]` POCO in `Sitrep.Contract` + register in `RtConfig.cs` + run `mod/codegen.sh`; the bare `avionics.available` is declared client-side via `registerBarePrimitiveTopic`
- **RP-1 is NOT installed in the local GameData** (`local_docs/syncthing/kspdata/GameData/RP-1-ExpressInstall/` is the CKAN meta-stub only; the RP-0 plugin is CKAN-installed separately) **and no RO fixtures are captured** (`local_docs/ro-fixtures/` empty). Therefore **every avionics symbol signature here is source-confidence and tagged [verify]** — resolve against a live Deck RP-1 smoke test or an `ilspycmd` dump of the RP-0 plugin before locking (DECISIONS "Still-VERIFY" discipline)
- Client widget composes `@ksp-gonogo/ui-kit` (StatusPill / BigReadout / Meter), imports framework surface from `@ksp-gonogo/sitrep-sdk`; accessibility baseline per repo CLAUDE.md (GO/NO-GO change wrapped in `role="status" aria-live="polite"`, 4.5:1 / 3:1 contrast, no colour-only state, `jest-axe` smoke)
- Design reference (read by absolute path): `/Users/jon.pepler/personal/gonogo/local_docs/kerbalism-RO-design-DECISIONS.md` (§RO/RP-1: "GonogoAvionicsUplink — RP-1 controllable-mass ascent go/no-go")

---

## Reference: RP-1 avionics controllability

- RP-1 part descriptions (confirmed in `GameData/RealismOverhaul/.../Avionics` cfgs): every avionics unit "allows full control over the vessel, up to the tonnage limit". The limit is the **controllable mass**.
- **[verify]** module + member names (RP-0 plugin, likely `RP0.dll` / `RP0Plugins`): `ModuleAvionics` (fixed-limit) and `ModuleProceduralAvionics` (mass-scaled). Candidate members: a `maxDensity`/`massLimit`/`controllableMass` field for the limit; a `GetInternalMassLimit()` method; a `controlLocked` / `systemEnabled` bool for whether avionics is active. The go/no-go is `vesselMassTons <= controllableMassTons`.
- Vessel current mass: from stock KSP (`vessel.totalMass` or the already-carried `vessel.*` mass telemetry) — NOT reflected from RP-1. The uplink combines the reflected limit with the stock mass.

## File Structure

- `mod/Sitrep.Contract/AvionicsPayloads.cs` — `[SitrepTopic("avionics.status")] AvionicsStatus` POCO (+ register in `RtConfig.cs`, Minor bump)
- `mod/GonogoAvionicsUplink/GonogoAvionicsUplink.csproj` (net48, MIT, reflection-only)
- `mod/GonogoAvionicsUplink/AvionicsReflection.cs` — probe + controllable-mass read (KSP shell)
- `mod/GonogoAvionicsUplink/AvionicsCapture.cs` — pure mapper (mass compare → dict)
- `mod/GonogoAvionicsUplink/AvionicsUplink.cs` — `[SitrepUplink("avionics")]`
- `mod/GonogoAvionicsUplink.Tests/*` — headless mapper tests
- `mod/GonogoAvionicsUplink/client/` — `@ksp-gonogo/avionics`: `AvionicsGoNoGo` widget + `topics.ts`

---

## Task 1: Contract payload `avionics.status`

**Files:**
- Create: `mod/Sitrep.Contract/AvionicsPayloads.cs`
- Modify: `mod/Sitrep.Contract/RtConfig.cs`, `mod/Sitrep.Contract/ContractVersion.cs`

**Interfaces:**
- Produces: Topic `avionics.status` → `AvionicsStatus`.

- [ ] **Step 1: Write the payload**

```csharp
// mod/Sitrep.Contract/AvionicsPayloads.cs
#if NETSTANDARD2_0
using Reinforced.Typings.Attributes;
#endif
namespace Sitrep.Contract
{
    [SitrepContract]
#if NETSTANDARD2_0
    [TsInterface]
#endif
    [SitrepTopic("avionics.status")]
    public sealed class AvionicsStatus
    {
        /// <summary>True when an avionics unit is present + active on the vessel.</summary>
        public bool? AvionicsActive { get; set; }
        /// <summary>Controllable-mass limit of the active avionics unit (tonnes). [verify]</summary>
        public double? ControllableMassTons { get; set; }
        /// <summary>Vessel current total mass (tonnes).</summary>
        public double? VesselMassTons { get; set; }
        /// <summary>Derived: VesselMassTons <= ControllableMassTons (the ascent go/no-go).</summary>
        public bool? Controllable { get; set; }
    }
}
```

- [ ] **Step 2: Register + bump** — add `typeof(AvionicsStatus)` to `RtConfig.cs` `ExportAsInterfaces`; bump `ContractVersion.Minor` (additive).

- [ ] **Step 3: Build the contract**

Run: `cd mod && dotnet build Sitrep.Contract/Sitrep.Contract.csproj -v minimal`
Expected: Build succeeded.

- [ ] **Step 4: Regenerate the SDK + assert the topic id**

Run: `cd mod && ./codegen.sh && cd .. && pnpm --filter @ksp-gonogo/sitrep-sdk test`
Add to `mod/sitrep-sdk/src/topics.test.ts`: `expect(GENERATED_TOPIC_IDS).toContain("avionics.status")`.
Expected: PASS after regen.

- [ ] **Step 5: Commit**

```bash
git add mod/Sitrep.Contract/AvionicsPayloads.cs mod/Sitrep.Contract/RtConfig.cs mod/Sitrep.Contract/ContractVersion.cs mod/sitrep-sdk/src/__generated__/ mod/sitrep-sdk/src/topics.test.ts
git commit -m "feat(contract): avionics.status Topic + SDK regen"
```

---

## Task 2: `AvionicsReflection` — controllable-mass read

**Files:**
- Create: `mod/GonogoAvionicsUplink/GonogoAvionicsUplink.csproj` (copy the RA reflection-only template; net48, MIT, KSP refs `Private="false"`, ProjectReference Sitrep.Contract `<Private>false</Private>`, no RP-0 reference)
- Create: `mod/GonogoAvionicsUplink/AvionicsReflection.cs`
- Create: `mod/GonogoAvionicsUplink/NOTICE-RP1.txt`
- Modify: `mod/Gonogo.sln`

**Interfaces:**
- Produces: `AvionicsReflection` with `bool IsAvailable`, `AvionicsRaw? Read(Vessel v)` (active-unit controllable-mass + active flag; null when no avionics present).

- [ ] **Step 1: Write the reflection helper**

```csharp
// mod/GonogoAvionicsUplink/AvionicsReflection.cs
// Reflection-only bridge to RP-1 avionics. No compile-time reference to the RP-0 plugin.
// ALL member names are [verify] against the RP-0 plugin (ilspycmd it) — resolve on the RP-1 pass.
using System;
using System.Reflection;

namespace GonogoAvionicsUplink
{
    public sealed class AvionicsReflection
    {
        private readonly Assembly? _asm;
        private readonly Type? _moduleAvionics;            // [verify] "RP0.ModuleAvionics"
        private readonly Type? _moduleProceduralAvionics;  // [verify] "RP0.ProceduralAvionics.ModuleProceduralAvionics"

        public bool IsAvailable => _asm != null && (_moduleAvionics != null || _moduleProceduralAvionics != null);

        public AvionicsReflection()
        {
            foreach (var a in AppDomain.CurrentDomain.GetAssemblies())
            {
                var n = a.GetName().Name;
                if (n != null && (n.StartsWith("RP0", StringComparison.OrdinalIgnoreCase) || n.Equals("RP-1", StringComparison.OrdinalIgnoreCase)))
                { _asm = a; break; }
            }
            _moduleAvionics = FindType("RP0.ModuleAvionics");                                   // [verify]
            _moduleProceduralAvionics = FindType("RP0.ProceduralAvionics.ModuleProceduralAvionics"); // [verify]
        }

        public AvionicsRaw? Read(Vessel v)
        {
            if (!IsAvailable || v?.parts == null) return null;
            double? bestLimit = null;
            bool active = false;
            foreach (var part in v.parts)
                foreach (var pm in part.Modules)
                {
                    var t = pm.GetType();
                    if ((_moduleAvionics != null && _moduleAvionics.IsAssignableFrom(t)) ||
                        (_moduleProceduralAvionics != null && _moduleProceduralAvionics.IsAssignableFrom(t)))
                    {
                        // [verify] method GetInternalMassLimit() -> tonnes, OR field massLimit / maxDensity
                        var limit = InvokeDouble(pm, t, "GetInternalMassLimit") ?? ReadDouble(pm, t, "massLimit");
                        if (limit is double l && (bestLimit == null || l > bestLimit)) bestLimit = l;
                        var systemEnabled = ReadBool(pm, t, "systemEnabled");   // [verify]
                        if (systemEnabled ?? true) active = true;
                    }
                }
            if (bestLimit == null) return null;
            return new AvionicsRaw { ControllableMassTons = bestLimit.Value, AvionicsActive = active };
        }

        private static double? InvokeDouble(object o, Type t, string m)
        {
            var mi = t.GetMethod(m, BindingFlags.Public | BindingFlags.Instance, null, Type.EmptyTypes, null);
            if (mi == null) return null; try { return Convert.ToDouble(mi.Invoke(o, null)); } catch { return null; }
        }
        private static double? ReadDouble(object o, Type t, string f)
        {
            var fi = t.GetField(f, BindingFlags.Public | BindingFlags.Instance);
            if (fi == null) return null; try { return Convert.ToDouble(fi.GetValue(o)); } catch { return null; }
        }
        private static bool? ReadBool(object o, Type t, string f)
        {
            var fi = t.GetField(f, BindingFlags.Public | BindingFlags.Instance);
            if (fi == null) return null; try { return (bool)fi.GetValue(o)!; } catch { return null; }
        }
        private Type? FindType(string fullName)
        {
            if (_asm != null) { try { var t = _asm.GetType(fullName); if (t != null) return t; } catch { } }
            foreach (var a in AppDomain.CurrentDomain.GetAssemblies())
                try { var t = a.GetType(fullName); if (t != null) return t; } catch { }
            return null;
        }
    }

    public sealed class AvionicsRaw
    {
        public double ControllableMassTons;
        public bool AvionicsActive;
    }
}
```

- [ ] **Step 2: Add to solution + build**

Run: `cd mod && dotnet sln Gonogo.sln add GonogoAvionicsUplink/GonogoAvionicsUplink.csproj && dotnet build GonogoAvionicsUplink/GonogoAvionicsUplink.csproj -v minimal /p:KspManaged=<ksp-managed-path>`
Expected: Build succeeded.

- [ ] **Step 3: Commit**

```bash
git add mod/GonogoAvionicsUplink/ mod/Gonogo.sln
git commit -m "feat(avionics): reflection bridge + uplink project scaffold"
```

---

## Task 3: `AvionicsCapture` pure mapper + headless test

**Files:**
- Create: `mod/GonogoAvionicsUplink/AvionicsCapture.cs`
- Create: `mod/GonogoAvionicsUplink.Tests/GonogoAvionicsUplink.Tests.csproj` (copy the RA test template; `<Compile Include="..\GonogoAvionicsUplink\AvionicsCapture.cs" />`)
- Create: `mod/GonogoAvionicsUplink.Tests/AvionicsCaptureTests.cs`
- Modify: `mod/Gonogo.sln`

**Interfaces:**
- Consumes: `AvionicsRaw` (Task 2) + a stock `vesselMassTons` scalar.
- Produces: `AvionicsCapture.Build(AvionicsRaw? raw, double vesselMassTons) -> Dictionary<string,object?>` matching `AvionicsStatus`.

- [ ] **Step 1: Write the failing test**

```csharp
// mod/GonogoAvionicsUplink.Tests/AvionicsCaptureTests.cs
using GonogoAvionicsUplink;
using Xunit;

public class AvionicsCaptureTests
{
    [Fact]
    public void Build_flags_no_go_when_mass_exceeds_limit()
    {
        var s = AvionicsCapture.Build(new AvionicsRaw { ControllableMassTons = 4.0, AvionicsActive = true }, vesselMassTons: 5.2);
        Assert.Equal(false, s["controllable"]);
        Assert.Equal(4.0, (double)s["controllableMassTons"]!, 6);
        Assert.Equal(5.2, (double)s["vesselMassTons"]!, 6);
        Assert.Equal(true, s["avionicsActive"]);
    }

    [Fact]
    public void Build_flags_go_when_within_limit()
    {
        var s = AvionicsCapture.Build(new AvionicsRaw { ControllableMassTons = 10.0, AvionicsActive = true }, vesselMassTons: 6.5);
        Assert.Equal(true, s["controllable"]);
    }

    [Fact]
    public void Build_reports_no_avionics_when_raw_null()
    {
        var s = AvionicsCapture.Build(null, vesselMassTons: 6.5);
        Assert.Equal(false, s["avionicsActive"]);
        Assert.Null(s["controllableMassTons"]);
        Assert.Equal(false, s["controllable"]);
    }
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd mod && dotnet test GonogoAvionicsUplink.Tests/GonogoAvionicsUplink.Tests.csproj`
Expected: FAIL to compile.

- [ ] **Step 3: Write the mapper**

```csharp
// mod/GonogoAvionicsUplink/AvionicsCapture.cs
using System.Collections.Generic;
namespace GonogoAvionicsUplink
{
    public static class AvionicsCapture
    {
        public static Dictionary<string, object?> Build(AvionicsRaw? raw, double vesselMassTons)
        {
            if (raw == null)
                return new Dictionary<string, object?>
                {
                    ["avionicsActive"] = false, ["controllableMassTons"] = null,
                    ["vesselMassTons"] = vesselMassTons, ["controllable"] = false,
                };
            return new Dictionary<string, object?>
            {
                ["avionicsActive"] = raw.AvionicsActive,
                ["controllableMassTons"] = raw.ControllableMassTons,
                ["vesselMassTons"] = vesselMassTons,
                ["controllable"] = vesselMassTons <= raw.ControllableMassTons,
            };
        }
    }
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `cd mod && dotnet test GonogoAvionicsUplink.Tests/GonogoAvionicsUplink.Tests.csproj`
Expected: PASS (3 tests).

- [ ] **Step 5: Add Tests project to solution + commit**

```bash
cd mod && dotnet sln Gonogo.sln add GonogoAvionicsUplink.Tests/GonogoAvionicsUplink.Tests.csproj && cd ..
git add mod/GonogoAvionicsUplink/AvionicsCapture.cs mod/GonogoAvionicsUplink.Tests/ mod/Gonogo.sln
git commit -m "feat(avionics): pure controllability mapper + headless tests"
```

---

## Task 4: `AvionicsUplink` — manifest, source, health

**Files:**
- Create: `mod/GonogoAvionicsUplink/AvionicsUplink.cs`

**Interfaces:**
- Consumes: `AvionicsReflection`, `AvionicsCapture`, `IUplinkHost`, `ISitrepUplink`.
- Produces: `[SitrepUplink("avionics")]`; `avionics.available` (TrueNow), `avionics.status` (Delayed).

- [ ] **Step 1: Write the uplink**

```csharp
// mod/GonogoAvionicsUplink/AvionicsUplink.cs
using System.Collections.Generic;
using Sitrep.Contract;
namespace GonogoAvionicsUplink
{
    [SitrepUplink("avionics")]
    public sealed class AvionicsUplink : ISitrepUplink
    {
        private const string AvailableTopic = "avionics.available";
        private const string StatusTopic = "avionics.status";
        private readonly AvionicsReflection _a = new();

        public UplinkManifest Manifest { get; }

        public AvionicsUplink()
        {
            Manifest = new UplinkManifest
            {
                Id = "avionics", Version = "1.0.0",
                Channels = new List<ChannelDeclaration>
                {
                    new ChannelDeclaration { Topic = AvailableTopic, Delivery = Delivery.LossyLatest,
                        Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
                        Delay = DelayRole.TrueNow },
                    new ChannelDeclaration { Topic = StatusTopic, Delivery = Delivery.LossyLatest,
                        Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
                        Delay = DelayRole.Delayed },
                },
            };
        }

        public void Register(IUplinkHost host)
        {
            host.AddChannelSource(AvailableTopic, _ => _a.IsAvailable);
            var pub = host.Publisher(StatusTopic);
            host.AddSampledSource(
                captureOnMainThread: snap =>
                {
                    var v = snap?.ActiveVessel;   // [verify] accessor; mirror RealAntennasUplink.CaptureOnMain
                    if (v == null || !_a.IsAvailable) return null;
                    // vessel.totalMass [verify accessor], expressed in tonnes by stock KSP
                    return new object?[] { _a.Read(v), (double)v.totalMass };
                },
                handleOnCourier: (cap, ut) =>
                {
                    if (cap is object?[] arr && arr.Length == 2)
                        pub.Publish(AvionicsCapture.Build(arr[0] as AvionicsRaw, (double)(arr[1] ?? 0.0)), ut);
                },
                subscriptionTopicPrefixes: new[] { StatusTopic });
        }

        public UplinkHealth Health() =>
            _a.IsAvailable ? UplinkHealth.Healthy : UplinkHealth.Unavailable("RP-1 avionics assembly not loaded");
    }
}
```

- [ ] **Step 2: Build + commit**

Run: `cd mod && dotnet build GonogoAvionicsUplink/GonogoAvionicsUplink.csproj -v minimal /p:KspManaged=<path>`
Expected: Build succeeded (align `snap.ActiveVessel` / `v.totalMass` accessor names with `RealAntennasUplink.CaptureOnMain` if they differ).

```bash
git add mod/GonogoAvionicsUplink/AvionicsUplink.cs
git commit -m "feat(avionics): uplink emitting avionics.status controllability go/no-go"
```

---

## Task 5: `@ksp-gonogo/avionics` client widget (ascent go/no-go)

**Files:**
- Create: `mod/GonogoAvionicsUplink/client/{package.json,tsconfig.json,vitest.config.ts,src/index.ts,src/topics.ts}`
- Create: `mod/GonogoAvionicsUplink/client/src/AvionicsGoNoGo/index.tsx`
- Create: `mod/GonogoAvionicsUplink/client/src/AvionicsGoNoGo/index.test.tsx`
- Modify: `packages/app/src/main.tsx`, `packages/app/package.json`

**Interfaces:**
- Consumes: `useTelemetry("avionics.status")` → `AvionicsStatus | undefined`.
- Produces: the `avionics-go-no-go` component registered from `@ksp-gonogo/avionics`.

- [ ] **Step 1: Scaffold the package** — copy `mod/GonogoScansatUplink/client/{package.json,tsconfig.json,vitest.config.ts}`; name `@ksp-gonogo/avionics`, MIT.

- [ ] **Step 2: Declare the presence topic**

```ts
// mod/GonogoAvionicsUplink/client/src/topics.ts
import { registerBarePrimitiveTopic } from "@ksp-gonogo/sitrep-sdk";
declare module "@ksp-gonogo/sitrep-sdk" {
  interface TopicPayloadMap { "avionics.available": boolean; }
}
registerBarePrimitiveTopic("avionics.available");
```

- [ ] **Step 3: Write the failing widget test**

```tsx
// mod/GonogoAvionicsUplink/client/src/AvionicsGoNoGo/index.test.tsx
import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { renderWithTelemetry } from "@ksp-gonogo/test-utils"; // or the local fake-source helper
import { AvionicsGoNoGoComponent } from "./index";

it("shows NO-GO when the vessel is over the controllable mass", async () => {
  renderWithTelemetry(<AvionicsGoNoGoComponent config={{}} />, {
    topics: { "avionics.status": { avionicsActive: true, controllableMassTons: 4.0, vesselMassTons: 5.2, controllable: false } },
  });
  expect(await screen.findByText(/NO[- ]?GO/i)).toBeInTheDocument();
});

it("shows GO when within the limit + has no axe violations", async () => {
  const { container } = renderWithTelemetry(<AvionicsGoNoGoComponent config={{}} />, {
    topics: { "avionics.status": { avionicsActive: true, controllableMassTons: 10, vesselMassTons: 6.5, controllable: true } },
  });
  expect(await screen.findByText(/\bGO\b/)).toBeInTheDocument();
  expect(await axe(container)).toHaveNoViolations();
});
```

- [ ] **Step 4: Run it to verify it fails**

Run: `pnpm --filter @ksp-gonogo/avionics test`
Expected: FAIL (module not found).

- [ ] **Step 5: Write the widget**

```tsx
// mod/GonogoAvionicsUplink/client/src/AvionicsGoNoGo/index.tsx
import { registerComponent, useTelemetry } from "@ksp-gonogo/sitrep-sdk";
import type { AvionicsStatus, ComponentProps } from "@ksp-gonogo/sitrep-sdk";
import { BigReadout, Panel, PanelTitle, StatusPill, Stack, Row } from "@ksp-gonogo/ui-kit";

type AvionicsConfig = Record<string, never>;

export function AvionicsGoNoGoComponent(_props: ComponentProps<AvionicsConfig>) {
  const s = useTelemetry("avionics.status") as AvionicsStatus | undefined;
  const controllable = s?.controllable ?? false;
  const noAvionics = !(s?.avionicsActive ?? false);
  const label = noAvionics ? "NO AVIONICS" : controllable ? "GO" : "NO-GO";
  const tone = noAvionics ? "warn" : controllable ? "go" : "nogo"; // map to ui-kit ValueTone
  return (
    <Panel>
      <PanelTitle>Avionics Control</PanelTitle>
      {/* mission-state change must be announced politely (repo a11y baseline) */}
      <Stack role="status" aria-live="polite">
        <StatusPill tone={tone}>{label}</StatusPill>
        <Row>
          <BigReadout label="Vessel mass" value={fmtTons(s?.vesselMassTons)} />
          <BigReadout label="Controllable" value={fmtTons(s?.controllableMassTons)} />
        </Row>
      </Stack>
    </Panel>
  );
}

function fmtTons(t?: number): string {
  return t == null ? "—" : `${t.toFixed(2)} t`;
}

registerComponent<AvionicsConfig>({
  id: "avionics-go-no-go",
  name: "Avionics Control",
  description: "RP-1 ascent controllability: is the vessel mass within the active avionics unit's tonnage limit.",
  tags: ["control", "ro"],
  defaultSize: { w: 4, h: 4 },
  minSize: { w: 2, h: 3 },
  component: AvionicsGoNoGoComponent,
  channels: ["avionics.status"],
  defaultConfig: {},
  actions: [],
  requires: ["flight"],
});
```

Map `tone`/`StatusPill`/`BigReadout`/`ValueTone` to the actual `@ksp-gonogo/ui-kit` exports (check `packages/ui-kit/src/index.ts`); if `StatusPill` takes a different tone vocabulary, adapt. The state text (`GO`/`NO-GO`/`NO AVIONICS`) must not rely on colour alone — the label carries the meaning.

- [ ] **Step 6: Write the registration entry**

```ts
// mod/GonogoAvionicsUplink/client/src/index.ts
import "./topics";
import "./AvionicsGoNoGo";
export { AvionicsGoNoGoComponent } from "./AvionicsGoNoGo";
```

- [ ] **Step 7: Run tests + typecheck**

Run: `pnpm install && pnpm --filter @ksp-gonogo/avionics test && pnpm --filter @ksp-gonogo/avionics typecheck`
Expected: PASS (2 tests + axe).

- [ ] **Step 8: Wire into the app**

Add `import("@ksp-gonogo/avionics");` to `packages/app/src/main.tsx` and `"@ksp-gonogo/avionics": "workspace:*"` to `packages/app/package.json`.

- [ ] **Step 9: Commit**

```bash
git add mod/GonogoAvionicsUplink/client/ packages/app/src/main.tsx packages/app/package.json pnpm-lock.yaml
git commit -m "feat(avionics): @ksp-gonogo/avionics ascent go/no-go widget + app wiring"
```

---

## Task 6: Full suite + RO live-verify checklist

**Files:** none (verification task)

- [ ] **Step 1: Full uncached suite**

Run: `pnpm build && pnpm test`
Expected: all packages green including `@ksp-gonogo/avionics`, `@ksp-gonogo/sitrep-sdk`.

- [ ] **Step 2: Lock the [verify] symbols on the RP-1 pass**

`ilspycmd` the RP-0 plugin (from the Deck's actual RP-1 install) → confirm the real `ModuleAvionics` / `ModuleProceduralAvionics` FQNs + the controllable-mass accessor (`GetInternalMassLimit()` vs `massLimit`) + the active flag. Fix `AvionicsReflection.cs`. Capture an `avionics-<scenario>.json` fixture (`local_docs/ro-fixtures/`) and add a headless mapper test grounded in it. Live-verify `avionics.status` on the wire under RP-1 and record in `local_docs/feature_log/`.

## Self-Review

- **Spec coverage:** RP-1 controllable-mass ascent go/no-go (Tasks 2-4 emit, Task 5 renders) ✓; presence-gated (`avionics.available`), mandatory health, delay-gated ✓; reflection-only MIT ✓; uplink owns its client widget (Task 5) per the architecture ✓; funds rule N/A (no spend action) ✓.
- **VERIFY tags** cover every RP-1 symbol (not installed locally, no fixtures) — expected, gated by Task 6.
- **Type consistency:** `AvionicsStatus` fields (`avionicsActive/controllableMassTons/vesselMassTons/controllable`) match across the C# POCO, the pure mapper dict keys, and the client read.
