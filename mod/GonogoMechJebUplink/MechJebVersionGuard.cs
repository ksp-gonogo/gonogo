using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;

namespace Gonogo.MechJebUplink
{
    /// <summary>
    /// Result of the mandatory version-guard probe (mirrors
    /// <c>GonogoScansatUplink.VersionGuard</c> / <c>GonogoKosUplink.KosVersionGuard</c>):
    /// assembly presence + member-existence for every MechJeb2 member this
    /// Uplink binds. Never throws, every failure mode degrades to
    /// <see cref="IsAvailable"/> = false with a <see cref="Reason"/>, per the
    /// fail-soft contract (<c>IUplinkHost.SetAvailability</c>).
    /// </summary>
    public readonly struct MechJebGuardResult
    {
        public bool IsAvailable { get; }
        public string? Reason { get; }

        private MechJebGuardResult(bool isAvailable, string? reason)
        {
            IsAvailable = isAvailable;
            Reason = reason;
        }

        public static readonly MechJebGuardResult Ok = new MechJebGuardResult(true, null);
        public static MechJebGuardResult Fail(string reason) => new MechJebGuardResult(false, reason);
    }

    /// <summary>
    /// Probes a MechJeb2 assembly for the public members the engage surface
    /// binds, locked against the installed 2.15.3.0 dll (see
    /// <c>local_docs/design/mechjeb-provider-and-vendoring.md</c> and
    /// <c>local_docs/design/mechjeb-decompile-lock.md</c>): the entry point
    /// (<c>VesselExtensions.GetMasterMechJeb</c>), the module members the
    /// controller reads off the core (<c>Ascent</c>, <c>AscentSettings</c>,
    /// <c>Node</c>, <c>Landing</c>, <c>Target</c>) with
    /// <c>MechJebModuleAscentSettings.AscentAutopilot</c> behind <c>Ascent</c>,
    /// the ascent engage handshake
    /// (<c>MechJebModuleAscentSettings.DesiredOrbitAltitude</c>,
    /// <c>EditableDoubleMult.Val</c>, <c>ComputerModule.Users</c>, <c>UserPool.Add</c>),
    /// the node executor (<c>MechJebModuleNodeExecutor.ExecuteOneNode</c>), and
    /// landing (<c>MechJebModuleLandingAutopilot.LandAtPositionTarget</c>).
    ///
    /// <para>Takes an <see cref="Assembly"/> (or a plain type list via
    /// <see cref="ProbeTypes"/>) rather than loading one itself, so it is
    /// unit-testable against a fake/absent assembly with no real MechJeb2.dll
    /// present, same pattern as the ScanSat/kOS guards.</para>
    /// </summary>
    public static class MechJebVersionGuard
    {
        /// <summary>Pinned known-good MechJeb2 major: the installed dll is 2.15.3.0.</summary>
        public const int MinKnownGoodMajor = 2;
        public const int MaxKnownGoodMajor = 2;

        public static MechJebGuardResult Probe(Assembly? mechJebAssembly)
        {
            if (mechJebAssembly == null)
            {
                return MechJebGuardResult.Fail("MechJeb2.dll not loaded");
            }

            Version? asmVersion = mechJebAssembly.GetName().Version;
            if (asmVersion != null &&
                (asmVersion.Major < MinKnownGoodMajor || asmVersion.Major > MaxKnownGoodMajor))
            {
                return MechJebGuardResult.Fail(
                    $"MechJeb2 {asmVersion} outside known-good range {MinKnownGoodMajor}.x-{MaxKnownGoodMajor}.x");
            }

            Type[] allTypes;
            try
            {
                allTypes = mechJebAssembly.GetTypes();
            }
            catch (ReflectionTypeLoadException ex)
            {
                allTypes = ex.Types.Where(t => t != null).Cast<Type>().ToArray();
            }

            return ProbeTypes(allTypes);
        }

        /// <summary>
        /// The member-probe half, split out so tests can supply an exact set
        /// of fake types (matched by simple name, same as production)
        /// without a real MechJeb2 assembly.
        /// </summary>
        public static MechJebGuardResult ProbeTypes(IReadOnlyList<Type> allTypes)
        {
            Type? vesselExtensions = allTypes.FirstOrDefault(t => t.Name == "VesselExtensions");
            Type? mechJebCore = allTypes.FirstOrDefault(t => t.Name == "MechJebCore");
            Type? computerModule = allTypes.FirstOrDefault(t => t.Name == "ComputerModule");
            Type? ascentSettings = allTypes.FirstOrDefault(t => t.Name == "MechJebModuleAscentSettings");
            Type? editableDoubleMult = allTypes.FirstOrDefault(t => t.Name == "EditableDoubleMult");
            Type? ascentAutopilot = allTypes.FirstOrDefault(t => t.Name == "MechJebModuleAscentBaseAutopilot");
            Type? userPool = allTypes.FirstOrDefault(t => t.Name == "UserPool");
            Type? nodeExecutor = allTypes.FirstOrDefault(t => t.Name == "MechJebModuleNodeExecutor");
            Type? landingAutopilot = allTypes.FirstOrDefault(t => t.Name == "MechJebModuleLandingAutopilot");

            var missingTypes = new List<string>();
            if (vesselExtensions == null) missingTypes.Add("VesselExtensions");
            if (mechJebCore == null) missingTypes.Add("MechJebCore");
            if (computerModule == null) missingTypes.Add("ComputerModule");
            if (ascentSettings == null) missingTypes.Add("MechJebModuleAscentSettings");
            if (editableDoubleMult == null) missingTypes.Add("EditableDoubleMult");
            if (ascentAutopilot == null) missingTypes.Add("MechJebModuleAscentBaseAutopilot");
            if (userPool == null) missingTypes.Add("UserPool");
            if (nodeExecutor == null) missingTypes.Add("MechJebModuleNodeExecutor");
            if (landingAutopilot == null) missingTypes.Add("MechJebModuleLandingAutopilot");

            if (missingTypes.Count > 0)
            {
                return MechJebGuardResult.Fail(
                    $"MechJeb2 member-existence probe: expected type(s) missing: {string.Join(", ", missingTypes)}");
            }

            var missing = new List<string>();
            RequireMethod(vesselExtensions!, "GetMasterMechJeb", missing);
            // The five cached module members MechJebController reads, plus the
            // ascent-path indirection behind Ascent. Probing the module registry
            // instead would assert a route the controller does not take, so a
            // release that moved any of these would pass the guard and then null
            // out at engage time; see MechJebController's own doc comment for
            // why Ascent in particular is the member most likely to move.
            RequireMember(mechJebCore!, "Ascent", missing);
            RequireMember(mechJebCore!, "AscentSettings", missing);
            RequireMember(mechJebCore!, "Node", missing);
            RequireMember(mechJebCore!, "Landing", missing);
            RequireMember(mechJebCore!, "Target", missing);
            RequireMember(ascentSettings!, "AscentAutopilot", missing);
            RequireMember(ascentSettings!, "DesiredOrbitAltitude", missing);
            RequireMember(editableDoubleMult!, "Val", missing);
            RequireMember(computerModule!, "Users", missing);
            RequireMethod(userPool!, "Add", missing);
            RequireMethod(nodeExecutor!, "ExecuteOneNode", missing);
            RequireMethod(landingAutopilot!, "LandAtPositionTarget", missing);

            if (missing.Count > 0)
            {
                return MechJebGuardResult.Fail(
                    $"MechJeb2 member-existence probe failed: {string.Join(", ", missing)}");
            }

            return MechJebGuardResult.Ok;
        }

        // Overload-safe existence check: NEVER call Type.GetMethod(name),
        // which throws AmbiguousMatchException on a method with more than one
        // public overload (GetComputerModule has both a generic <T>() and a
        // string(Type) overload). GetMethods().Any(...) handles any overload
        // count and covers public instance + static (GetMethods' default
        // BindingFlags), which is all this probe asserts. Mirrors
        // GonogoScansatUplink.VersionGuard.RequireMethod exactly.
        private static void RequireMethod(Type t, string name, List<string> missing)
        {
            if (t.GetMethods().All(m => m.Name != name))
            {
                missing.Add($"{t.Name}.{name}()");
            }
        }

        // Checks property OR field: the decompile-lock doc is explicit that
        // MechJebCore.Target is a FIELD (was the lower-case `target`), while
        // most of the settings surface is more likely a property; the probe
        // only needs to confirm the MEMBER exists, not how it is exposed, the
        // real controller code binds to it directly at compile time. Mirrors
        // GonogoKosUplink.KosVersionGuard.RequireMember.
        private static void RequireMember(Type t, string name, List<string> missing)
        {
            if (t.GetProperty(name) == null && t.GetField(name) == null)
            {
                missing.Add($"{t.Name}.{name}");
            }
        }
    }
}
