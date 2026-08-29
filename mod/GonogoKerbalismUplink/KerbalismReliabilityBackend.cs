using System.Collections.Generic;
using Sitrep.Contract;

namespace Gonogo.KerbalismUplink
{
    /// <summary>
    /// Kerbalism's <see cref="IReliabilityBackend"/>: the LOW-specificity
    /// (Priority 1) provider of the "reliability" capability. Reads the active
    /// vessel internally (FlightGlobals) like <see cref="ICommsBackend"/>
    /// implementations, so the interface stays KSP-free; the reflection + POCO
    /// mapping are done by <see cref="KerbalismReflection"/> +
    /// <see cref="KerbalismReliabilityMap"/>.
    /// </summary>
    public sealed class KerbalismReliabilityBackend : IReliabilityBackend
    {
        private readonly KerbalismReflection _k;

        public KerbalismReliabilityBackend(KerbalismReflection k) => _k = k;

        public string ProviderId => "kerbalism";

        /// <summary>
        /// Three gates, in order, and none of them collapses into another.
        ///
        /// <para>The <c>mtbfFailures</c> gate is load-bearing and is not optional.
        /// With <c>Features.Reliability</c> ON and
        /// <c>PreferencesReliability.Instance.mtbfFailures</c> OFF the entire
        /// wear-and-break path is skipped (Kerbalism's own <c>Reliability</c>
        /// FixedUpdate guards on it): the failure deadline is never rolled, nothing
        /// wears, nothing ever breaks by MTBF, and every part reads clean. Without
        /// this gate the operator would be told the craft is watched and healthy
        /// while nothing at all is being modelled.</para>
        ///
        /// <para>It is also the reason <c>Indeterminate</c> is reachable at all:
        /// <c>KERBALISM.Features.Reliability</c> is a public static bool, so
        /// whenever the Features type resolves the key is present, and a tri-state
        /// cut only there would be cut at a seam nothing crosses.</para>
        /// </summary>
        public string Coverage =>
            KerbalismReliabilityMap.ComputeCoverage(
                _k.Features(), _k.ReliabilityPreferences());

        /// <summary>
        /// Whether this backend should TAKE the exclusive "reliability" capability
        /// at all, asked by the factory rather than answered after the fact.
        ///
        /// <para>Holding the capability and then reporting <c>Disabled</c> starves
        /// every lower-priority provider that could actually have modelled
        /// reliability on this install: an exclusive capability is held by exactly
        /// one provider, and one that models nothing is still holding it. A
        /// higher-priority provider currently outranks this backend on the only
        /// installs anyone runs, so nothing visibly breaks, which is precisely
        /// why it would have gone unnoticed.</para>
        ///
        /// <para>The cut is DEFINITE-off only. <c>Indeterminate</c> still takes the
        /// capability, because declining hands it to the vanilla fallback, which
        /// answers "nothing is installed that could model reliability", and that is
        /// a false statement when Kerbalism is sitting right there unable to say
        /// which way its own switch is set. Serving and admitting the uncertainty
        /// is the honest answer; declining would launder it into a clean one.</para>
        /// </summary>
        public static bool CanServe(KerbalismReflection k) =>
            KerbalismReliabilityMap.CanServe(
                k.Features(), k.ReliabilityPreferences());

        public ReliabilitySummary Summary()
        {
            // ONE Coverage computation per call rather than one per gate: the
            // property reflects, and the core uplink reads Summary and Parts back
            // to back on the same tick.
            var coverage = Coverage;
            var v = FlightGlobals.ActiveVessel;
            var raw = v != null ? _k.Reliability(v) : new ReliabilityRaw();
            return KerbalismReliabilityMap.Summary(raw, _k.ReliabilityPreferences(), coverage);
        }

        public IReadOnlyList<ReliabilityPartEntry> Parts()
        {
            var coverage = Coverage;
            var v = FlightGlobals.ActiveVessel;
            var raw = v != null ? _k.Reliability(v) : new ReliabilityRaw();
            return KerbalismReliabilityMap.Parts(raw, coverage);
        }
    }
}
