using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;

namespace Gonogo.ScansatUplink
{
    /// <summary>
    /// Result of the mandatory version-guard probe (scansat-migration-
    /// spec.md §3): assembly presence, member-existence, and SCANtype
    /// value assertion. Never throws — every failure mode degrades to
    /// <see cref="IsAvailable"/> = false with a <see cref="Reason"/>, per
    /// the fail-soft contract (<c>IUplinkHost.SetAvailability</c>).
    /// </summary>
    public readonly struct VersionGuardResult
    {
        public bool IsAvailable { get; }
        public string? Reason { get; }

        private VersionGuardResult(bool isAvailable, string? reason)
        {
            IsAvailable = isAvailable;
            Reason = reason;
        }

        public static readonly VersionGuardResult Ok = new VersionGuardResult(true, null);
        public static VersionGuardResult Fail(string reason) => new VersionGuardResult(false, reason);
    }

    /// <summary>
    /// Probes a SCANsat assembly for the public members this Uplink
    /// depends on (§3): <c>SCANUtil.GetCoverage</c>, <c>SCANUtil.isCovered</c>,
    /// <c>SCANcontroller.controller</c>, <c>SCANcontroller.getData</c>,
    /// <c>SCANcontroller.Known_Vessels</c>, <c>SCANdata.Coverage</c>,
    /// <c>SCANdata.Anomalies</c> — plus a <c>SCANtype</c> enum value
    /// assertion (a silently renumbered bit is the one drift a member-
    /// existence check misses). Takes an <see cref="Assembly"/> rather than
    /// loading one itself so it's unit-testable against a fake/absent
    /// assembly without a real SCANsat.dll.
    /// </summary>
    public static class VersionGuard
    {
        /// <summary>Pinned known-good range per §3: SCANsat 20.x-21.x.</summary>
        public const int MinKnownGoodMajor = 20;
        public const int MaxKnownGoodMajor = 21;

        private static readonly (string EnumValueName, short Expected)[] ExpectedScanTypeValues =
        {
            ("AltimetryLoRes", 1),
            ("ResourceHiRes", 256),
        };

        public static VersionGuardResult Probe(Assembly? scanSatAssembly)
        {
            if (scanSatAssembly == null)
            {
                return VersionGuardResult.Fail("SCANsat.dll not loaded");
            }

            Version? asmVersion = scanSatAssembly.GetName().Version;
            if (asmVersion != null &&
                (asmVersion.Major < MinKnownGoodMajor || asmVersion.Major > MaxKnownGoodMajor))
            {
                return VersionGuardResult.Fail(
                    $"SCANsat {asmVersion} outside known-good range {MinKnownGoodMajor}.x-{MaxKnownGoodMajor}.x");
            }

            Type[] allTypes;
            try
            {
                allTypes = scanSatAssembly.GetTypes();
            }
            catch (ReflectionTypeLoadException ex)
            {
                allTypes = ex.Types.Where(t => t != null).Cast<Type>().ToArray();
            }

            return ProbeTypes(allTypes, asmVersion);
        }

        /// <summary>
        /// The member/enum-probe half of <see cref="Probe(Assembly?)"/>,
        /// split out so tests can supply an exact, unambiguous set of fake
        /// types (matched by simple name, same as production) without
        /// needing a real or dynamically-built SCANsat assembly.
        /// </summary>
        public static VersionGuardResult ProbeTypes(IReadOnlyList<Type> allTypes, Version? asmVersion = null)
        {
            Type? scanUtil = allTypes.FirstOrDefault(t => t.Name == "SCANUtil");
            Type? scanController = allTypes.FirstOrDefault(t => t.Name == "SCANcontroller");
            Type? scanData = allTypes.FirstOrDefault(t => t.Name == "SCANdata");
            Type? scanType = allTypes.FirstOrDefault(t => t.Name == "SCANtype");

            if (scanUtil == null || scanController == null || scanData == null || scanType == null)
            {
                return VersionGuardResult.Fail("SCANsat member-existence probe: one or more expected types missing");
            }

            var missing = new List<string>();
            RequireMethod(scanUtil, "GetCoverage", missing);
            RequireMethod(scanUtil, "isCovered", missing);
            RequireStaticProperty(scanController, "controller", missing);
            RequireMethod(scanController, "getData", missing);
            RequireProperty(scanController, "Known_Vessels", missing);
            RequireProperty(scanData, "Coverage", missing);
            RequireProperty(scanData, "Anomalies", missing);

            if (missing.Count > 0)
            {
                return VersionGuardResult.Fail(
                    $"SCANsat member-existence probe failed: {string.Join(", ", missing)}");
            }

            if (!scanType.IsEnum)
            {
                return VersionGuardResult.Fail("SCANtype is no longer an enum");
            }

            foreach (var (name, expected) in ExpectedScanTypeValues)
            {
                object? raw = Enum.GetNames(scanType).Contains(name)
                    ? Enum.Parse(scanType, name)
                    : null;
                if (raw == null)
                {
                    return VersionGuardResult.Fail($"SCANtype.{name} no longer exists");
                }
                short actual = Convert.ToInt16(raw);
                if (actual != expected)
                {
                    return VersionGuardResult.Fail(
                        $"SCANtype.{name} = {actual}, expected {expected} (renumbered bit)");
                }
            }

            return VersionGuardResult.Ok;
        }

        private static void RequireMethod(Type t, string name, List<string> missing)
        {
            // Overload-safe existence check: NEVER call Type.GetMethod(name),
            // which throws AmbiguousMatchException when the method has more than
            // one public overload. Real SCANsat 21.1 has TWO overloads each of
            // SCANUtil.isCovered and SCANcontroller.getData, so the old
            // `GetMethod(name) == null && ...` form threw before the fallback
            // could run — the exception bubbled up through Probe and was caught in
            // ScansatUplink.Register as "version-guard probe threw", flipping the
            // whole uplink Unavailable (no scansat.* stream-data ever). The
            // GetMethods().Any(...) name scan handles any overload count and
            // covers public instance + static methods (GetMethods' default
            // BindingFlags), which is all this probe asserts.
            if (t.GetMethods().All(m => m.Name != name))
            {
                missing.Add($"{t.Name}.{name}()");
            }
        }

        private static void RequireProperty(Type t, string name, List<string> missing)
        {
            if (t.GetProperty(name) == null) missing.Add($"{t.Name}.{name}");
        }

        private static void RequireStaticProperty(Type t, string name, List<string> missing)
        {
            if (t.GetProperty(name, BindingFlags.Public | BindingFlags.Static) == null &&
                t.GetField(name, BindingFlags.Public | BindingFlags.Static) == null)
            {
                missing.Add($"{t.Name}.{name}");
            }
        }
    }
}
