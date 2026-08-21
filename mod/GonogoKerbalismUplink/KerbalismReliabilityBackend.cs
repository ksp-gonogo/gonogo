using System.Collections.Generic;
using Sitrep.Contract;

namespace Gonogo.KerbalismUplink
{
    /// <summary>
    /// Kerbalism's <see cref="IReliabilityBackend"/>: the LOW-specificity
    /// (Priority 1) provider of the "reliability" capability. Reports
    /// <c>Unmodeled=true</c> when <c>Features.Reliability</c> is off (RO/RP-1,
    /// where TestFlight owns engine failures and outranks this at Priority 10).
    /// Reads the active vessel internally (FlightGlobals) like <see cref="ICommsBackend"/>
    /// implementations, so the interface stays KSP-free; the reflection + POCO
    /// mapping are done by <see cref="KerbalismReflection"/> + <see cref="KerbalismReliabilityMap"/>.
    /// </summary>
    public sealed class KerbalismReliabilityBackend : IReliabilityBackend
    {
        private readonly KerbalismReflection _k;

        public KerbalismReliabilityBackend(KerbalismReflection k) => _k = k;

        public string ProviderId => "kerbalism";

        public bool IsModeled => Modeled();

        private bool Modeled() => _k.Features().TryGetValue("Reliability", out var on) && on;

        public ReliabilitySummary Summary()
        {
            var v = FlightGlobals.ActiveVessel;
            var raw = v != null ? _k.Reliability(v) : new ReliabilityRaw();
            return KerbalismReliabilityMap.Summary(raw, Modeled());
        }

        public IReadOnlyList<ReliabilityPartEntry> Parts()
        {
            var v = FlightGlobals.ActiveVessel;
            var raw = v != null ? _k.Reliability(v) : new ReliabilityRaw();
            return KerbalismReliabilityMap.Parts(raw, Modeled());
        }
    }
}
