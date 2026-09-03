using System.Collections.Generic;
using Sitrep.Contract;

namespace Sitrep.Host.Reliability
{
    /// <summary>
    /// The always-present Vanilla reliability backend: no modelling mod
    /// registered a provider, so nothing is watching and there is no per-part
    /// data. A stock KSP install (no Kerbalism-Reliability, no TestFlight)
    /// resolves to this and reports <c>Coverage = "none"</c>: not "healthy", and
    /// not "off", but "nothing is installed that could model this". KSP-free.
    ///
    /// <para>This backend is ALSO the instance a capability falls through to when
    /// a selected provider's factory threw, and it cannot tell the two apart. The
    /// <c>Coverage = "unavailable"</c> override for that case is applied by
    /// <c>Gonogo.KSP.ReliabilityCoreUplink</c>, which can read the Kernel's
    /// <c>factory-failed</c> notice.</para>
    /// </summary>
    public sealed class NoneReliabilityBackend : IReliabilityBackend
    {
        public string ProviderId => "none";

        public string Coverage => ReliabilityCoverage.None;

        public ReliabilitySummary Summary() => new()
        {
            Source = "none",
            Coverage = ReliabilityCoverage.None,
        };

        public IReadOnlyList<ReliabilityPartEntry> Parts() => new List<ReliabilityPartEntry>();

        /// <summary>
        /// Nothing models reliability here, so nothing can repair. Refused
        /// rather than thrown: the command has to be answerable on every
        /// install, and a refusal costs the operator the same round trip a
        /// success would, so it says why.
        /// </summary>
        public RepairOutcome Repair(string partId, string crewName) =>
            new RepairOutcome { Repaired = false, Refusal = RepairRefusal.NotModelled };
    }
}
