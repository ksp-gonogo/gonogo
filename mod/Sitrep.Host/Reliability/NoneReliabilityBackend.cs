using System.Collections.Generic;
using Sitrep.Contract;

namespace Sitrep.Host.Reliability
{
    /// <summary>
    /// The always-present Vanilla reliability backend: no modelling mod is
    /// installed, so reliability is <c>Unmodeled</c> and there is no per-part
    /// data. A stock KSP install (no Kerbalism-Reliability, no TestFlight)
    /// resolves to this — the client shows "reliability not modelled" rather
    /// than a missing Topic. KSP-free.
    /// </summary>
    public sealed class NoneReliabilityBackend : IReliabilityBackend
    {
        public string BackendId => "none";

        public bool IsModeled => false;

        public ReliabilitySummary Summary() => new()
        {
            Unmodeled = true,
            Malfunction = false,
            Critical = false,
            Source = "none",
            WorstReliabilityFraction = null,
        };

        public IReadOnlyList<ReliabilityPartEntry> Parts() => new List<ReliabilityPartEntry>();
    }
}
