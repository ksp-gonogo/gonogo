using System;
using System.Reflection;

namespace GonogoPrincipiaUplink
{
    /// <summary>
    /// Result of the mandatory version-guard probe (mirrors
    /// the sibling uplinks' own version guards):
    /// never throws, and every failure mode degrades to
    /// <see cref="IsAvailable"/> = false with a <see cref="Reason"/>, per the
    /// fail-soft contract.
    /// </summary>
    public readonly struct PrincipiaGuardResult
    {
        public bool IsAvailable { get; }
        public string? Reason { get; }
        /// <summary>The detected assembly version, for the roster's detail line. Null when absent.</summary>
        public Version? DetectedVersion { get; }

        private PrincipiaGuardResult(bool isAvailable, string? reason, Version? detected)
        {
            IsAvailable = isAvailable;
            Reason = reason;
            DetectedVersion = detected;
        }

        public static PrincipiaGuardResult Ok(Version? detected) =>
            new PrincipiaGuardResult(true, null, detected);

        public static PrincipiaGuardResult Fail(string reason, Version? detected = null) =>
            new PrincipiaGuardResult(false, reason, detected);
    }

    /// <summary>
    /// Detects Principia by ASSEMBLY PRESENCE AND VERSION ONLY.
    ///
    /// <para><b>It binds no members, and that is the whole design.</b> Every other
    /// version guard in this repo probes the members its Uplink then calls;
    /// this one deliberately probes nothing, because there is nothing it is
    /// allowed to call. Principia's external plugin API was deleted, and the
    /// surviving native exports all require an opaque handle obtainable only
    /// through a non-public method, must be bound by <c>dlsym</c> rather than
    /// <c>[DllImport]</c>, and abort the KSP PROCESS on a bad argument
    /// (<c>CHECK</c>/<c>LOG(FATAL)</c>) rather than throwing something
    /// catchable. A process abort is categorically worse than every failure the
    /// graceful-degradation rule exists to prevent, so that route is refused
    /// and this Uplink never takes it.</para>
    ///
    /// <para>What presence alone buys is real: the elected propagation provider
    /// can state that its trajectories are INTEGRATED rather than analytic, and
    /// bound how far they may be extrapolated. Both are computed from telemetry
    /// already on our own wire, so this guard is the only thing that has to know
    /// the mod exists at all.</para>
    ///
    /// <para>The version is read from the assembly rather than from Principia's
    /// own <c>GetVersion</c> export, which is itself version-dependent (it
    /// gained a parameter in a past release), so probing it would reintroduce
    /// exactly the coupling this guard avoids.</para>
    ///
    /// <para>Takes an <see cref="Assembly"/> rather than loading one, so it is
    /// unit-testable with no Principia present, which is also its primary live
    /// case.</para>
    /// </summary>
    public static class PrincipiaVersionGuard
    {
        /// <summary>
        /// The assembly Principia's KSP adapter ships as. Matched exactly rather
        /// than by prefix: a prefix match would also accept an unrelated
        /// assembly that merely starts with the same word.
        /// </summary>
        public const string AssemblyName = "ksp_plugin_adapter";

        /// <summary>
        /// Known-good majors. Principia versions by mathematician rather than by
        /// semver and its assembly version has been stable at this major, so the
        /// range is a floor against a future reshape rather than a tight pin: an
        /// unknown major degrades to unavailable instead of being trusted.
        /// </summary>
        public const int MinKnownGoodMajor = 1;
        public const int MaxKnownGoodMajor = 1;

        /// <summary>
        /// Probes a candidate assembly. Null (the mod absent) is the ORDINARY
        /// case, not an error: Principia is optional and everything degrades to
        /// the stock two-body provider without it.
        /// </summary>
        public static PrincipiaGuardResult Probe(Assembly? principiaAssembly)
        {
            if (principiaAssembly == null)
            {
                return PrincipiaGuardResult.Fail("Principia not loaded");
            }

            AssemblyName name;
            Version? version = null;
            try
            {
                name = principiaAssembly.GetName();
                version = name.Version;
            }
            catch (Exception ex)
            {
                return PrincipiaGuardResult.Fail("Principia assembly unreadable: " + ex.Message);
            }

            if (!string.Equals(name.Name, AssemblyName, StringComparison.OrdinalIgnoreCase))
            {
                return PrincipiaGuardResult.Fail(
                    "not Principia's adapter assembly: " + (name.Name ?? "<unnamed>"));
            }

            if (version != null &&
                (version.Major < MinKnownGoodMajor || version.Major > MaxKnownGoodMajor))
            {
                return PrincipiaGuardResult.Fail(
                    "Principia " + version + " outside known-good range " +
                    MinKnownGoodMajor + ".x-" + MaxKnownGoodMajor + ".x",
                    version);
            }

            return PrincipiaGuardResult.Ok(version);
        }

        /// <summary>
        /// Finds Principia's adapter among loaded assemblies and probes it.
        /// Enumeration failures degrade to unavailable rather than propagating:
        /// a reflection fault must not take the mod down over an OPTIONAL
        /// dependency.
        /// </summary>
        public static PrincipiaGuardResult ProbeLoaded()
        {
            try
            {
                foreach (var candidate in AppDomain.CurrentDomain.GetAssemblies())
                {
                    if (candidate == null) continue;
                    string? candidateName;
                    try
                    {
                        candidateName = candidate.GetName().Name;
                    }
                    catch (Exception)
                    {
                        continue;
                    }
                    if (string.Equals(candidateName, AssemblyName, StringComparison.OrdinalIgnoreCase))
                    {
                        return Probe(candidate);
                    }
                }
            }
            catch (Exception ex)
            {
                return PrincipiaGuardResult.Fail("could not enumerate assemblies: " + ex.Message);
            }

            return PrincipiaGuardResult.Fail("Principia not loaded");
        }
    }
}
