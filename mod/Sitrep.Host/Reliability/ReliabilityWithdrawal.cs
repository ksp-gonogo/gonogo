using System.Collections.Generic;
using Sitrep.Contract;

namespace Sitrep.Host.Reliability
{
    /// <summary>
    /// Recovers the fact that <see cref="NoneReliabilityBackend"/> structurally
    /// cannot carry: whether a provider that COULD have modelled reliability was
    /// installed and withdrew.
    ///
    /// <para>Withdrawing is correct: a provider whose own reliability feature is
    /// switched off must not hold an exclusive capability while modelling
    /// nothing. But withdrawal removes it from the election, so on an install
    /// with nothing else registered the capability falls to the vanilla backend,
    /// whose reading is "nothing is installed that could model reliability".
    /// With a modelling mod sitting right there and switched off, that is false,
    /// and false in the direction that reads as reassurance: the operator is
    /// told nothing could be silently breaking, when in fact nothing is
    /// WATCHING.</para>
    ///
    /// <para>The two facts stay distinguishable on the wire: <c>none</c> keeps
    /// its literal meaning (no provider exists), and a withdrawal is reported as
    /// <c>disabled</c> named to the provider that switched itself off.</para>
    ///
    /// <para>KSP-free and pure, so the decision is testable headlessly. Its one
    /// caller, <c>Gonogo.KSP.ReliabilityCoreUplink</c>, reads live KSP and cannot
    /// be compiled into a test assembly.</para>
    /// </summary>
    public static class ReliabilityWithdrawal
    {
        /// <summary>
        /// The provider that withdrew from the reliability capability, or null if
        /// none did. When several withdrew the first is reported: the coverage
        /// field names one source, and "some provider is installed and switched
        /// off" is the fact the operator needs either way.
        /// </summary>
        public static string? WithdrawnProviderId(IEnumerable<ResolutionNotice>? notices)
        {
            if (notices == null) return null;
            foreach (var notice in notices)
            {
                if (notice == null) continue;
                if (notice.Capability != ReliabilityElection.CapabilityId) continue;
                // Matched by KIND, never by sniffing Detail: a reworded sentence
                // must not silently stop matching. "superseded" is deliberately
                // not a withdrawal, something else won and speaks for itself.
                if (notice.Kind != "provider-declined") continue;
                if (string.IsNullOrEmpty(notice.ProviderId)) continue;
                return notice.ProviderId;
            }
            return null;
        }

        /// <summary>
        /// Correct a vanilla reading in place when a provider withdrew.
        ///
        /// <para>Only ever touches a summary that says <c>none</c>. A real
        /// provider won the election in every other case, and its own account of
        /// what it is modelling outranks anything inferrable from a notice.</para>
        /// </summary>
        public static ReliabilitySummary Apply(
            ReliabilitySummary summary,
            IEnumerable<ResolutionNotice>? notices)
        {
            if (summary == null) return summary!;
            if (summary.Coverage != ReliabilityCoverage.None) return summary;

            var withdrawn = WithdrawnProviderId(notices);
            if (withdrawn == null) return summary;

            summary.Source = withdrawn;
            summary.Coverage = ReliabilityCoverage.Disabled;
            return summary;
        }
    }
}
