using System;
using System.Collections.Generic;
using Sitrep.Contract;

namespace Gonogo.KerbalismUplink
{
    /// <summary>
    /// Kerbalism's <see cref="IReliabilityBackend"/>: the LOW-specificity
    /// (Priority 1) provider of the "reliability" capability. Resolves the
    /// vessel internally, like <see cref="ICommsBackend"/> implementations, so
    /// the interface stays KSP-free; the reflection + POCO mapping are done by
    /// <see cref="KerbalismReflection"/> + <see cref="KerbalismReliabilityMap"/>.
    ///
    /// <para><b>The vessel comes from core's <c>activeVessel</c> capability
    /// rather than from KSP directly.</b> Those stopped being the same answer
    /// when core began reporting the craft an EVA kerbal stepped out of. The
    /// parts listing an operator picks a part id off is the CRAFT's; KSP's own
    /// answer is the kerbal, which has one part, so every id resolved against
    /// the wrong vehicle and came back <c>no-such-part</c>. Going outside to fix
    /// a failed part is exactly when a repair is wanted, so the path was dead in
    /// the one situation it exists for.</para>
    /// </summary>
    public sealed class KerbalismReliabilityBackend : IReliabilityBackend
    {
        private readonly KerbalismReflection _k;
        private readonly Kernel? _kernel;

        /// <param name="kernel">
        /// Core's capability registry, for the <c>activeVessel</c> resolution
        /// described above. Optional, and null means no vessel is resolved: the
        /// reads then report a craft they could not see, which is the honest
        /// degradation, rather than the wrong craft.
        /// </param>
        public KerbalismReliabilityBackend(KerbalismReflection k, Kernel? kernel = null)
        {
            _k = k;
            _kernel = kernel;
        }

        /// <summary>
        /// The vessel every read here and the repair below are scoped to, or
        /// null when there is no flight and when core does not publish the
        /// capability (an older core, or one whose declaration failed).
        ///
        /// <para>Queried per call rather than held, as
        /// <see cref="IActiveVessel"/> requires: the answer changes on a vessel
        /// switch, a dock, an undock, and on both ends of an EVA.</para>
        /// </summary>
        private Vessel? ScopedVessel() => _kernel.ReportedVessel() as Vessel;

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
            var v = ScopedVessel();
            var raw = v != null ? _k.Reliability(v) : new ReliabilityRaw();
            return KerbalismReliabilityMap.Summary(raw, _k.ReliabilityPreferences(), coverage);
        }

        /// <summary>
        /// One repair, whole intent, single call. See
        /// <see cref="KerbalismReflection.AttemptRepair"/> for the mechanism and
        /// for why the kit guard has to be held off around it.
        ///
        /// <para>Refuses when this save is not modelling failures at all,
        /// rather than reaching for a module that will not be there. The
        /// backend withdraws from the capability entirely in that case, so this
        /// is belt and braces for the indeterminate window.</para>
        /// </summary>
        public RepairOutcome Repair(string partId, string crewName)
        {
            if (Coverage != ReliabilityCoverage.Modeled)
            {
                return new RepairOutcome { Repaired = false, Refusal = RepairRefusal.NotModelled };
            }

            var v = ScopedVessel();
            if (v == null)
            {
                return new RepairOutcome { Repaired = false, Refusal = RepairRefusal.NoSuchPart };
            }

            var raw = _k.AttemptRepair(v, partId, crewName);
            return new RepairOutcome
            {
                Repaired = raw.Repaired,
                Refusal = raw.Refusal,
                KitsUsed = raw.KitsUsed,
                KitsFrom = raw.KitsFrom,
            };
        }

        public IReadOnlyList<ReliabilityPartEntry> Parts()
        {
            var coverage = Coverage;
            var v = ScopedVessel();
            var raw = v != null ? _k.Reliability(v) : new ReliabilityRaw();
            // The kit requirement is an install PREFERENCE, not a per-part fact,
            // so it is read here beside Coverage rather than carried on every
            // part of the capture.
            return KerbalismReliabilityMap.Parts(
                raw,
                coverage,
                _k.ReliabilityPreferences().RequireRepairKits);
        }
    }
}
