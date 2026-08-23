using System;
using System.Collections.Generic;
using System.Globalization;

using Sitrep.Contract;

namespace GonogoPrincipiaUplink
{
    /// <summary>
    /// What the binary gate concluded, said in the terms the uplink roster already
    /// uses: a coarse state, one sentence, and the identity of the file the sentence
    /// is about.
    ///
    /// <para>The split is the design. An operator glancing at the roster is asking
    /// one question, whether the Principia they have is one this uplink can compute
    /// against, and that is what <see cref="UplinkHealthState"/> answers. Which file,
    /// which release, which hash and how many exports are what somebody diagnosing a
    /// bad answer has to quote, and those are facts rather than status: nobody reads
    /// a SHA at a glance and nobody reports an unvetted build without one.</para>
    ///
    /// <para>Built once and held, because <see cref="ISitrepUplink.Health"/> is
    /// polled on every roster sample while the gate that produced this scans tens of
    /// megabytes and starts a worker process. Composing the strings per poll would
    /// put allocation on the Courier thread to rebuild a constant.</para>
    /// </summary>
    public sealed class PrincipiaBinaryHealth
    {
        private readonly UplinkHealthState _state;
        private readonly string _detail;
        private readonly IReadOnlyList<UplinkHealthFact> _facts;

        private PrincipiaBinaryHealth(
            UplinkHealthState state, string detail, IReadOnlyList<UplinkHealthFact> facts)
        {
            _state = state;
            _detail = detail;
            _facts = facts;
        }

        public UplinkHealth ToHealth() => new UplinkHealth(_state, _detail, _facts);

        /// <summary>
        /// The reading taken before the gate has concluded: Principia's managed
        /// assembly is loaded, and which native build it will map is not yet known.
        ///
        /// <para>Healthy rather than degraded, and the distinction is not cosmetic.
        /// The flight plan, the settings and the plan mirror are all read through the
        /// managed assembly and work whatever the native gate later says, so reporting
        /// a problem here would attach one to channels that have none. What is not yet
        /// known is stated in the sentence instead.</para>
        /// </summary>
        public static PrincipiaBinaryHealth Detecting(Version? assemblyVersion) =>
            new PrincipiaBinaryHealth(
                UplinkHealthState.Healthy,
                "Reading which Principia build the game has loaded.",
                new[] { VersionFact(assemblyVersion) });

        /// <summary>
        /// The reading once the gate has answered, with what the worker decision
        /// concluded about reproducing the game's arithmetic folded in.
        ///
        /// <para>Only a Conformant build is Healthy. Everything else is Degraded and
        /// never Unavailable, because Unavailable is this roster's word for an uplink
        /// that is not working, and an unreadable native build leaves every channel
        /// this uplink publishes working exactly as before. Saying Unavailable would
        /// hide a flight plan that is being read correctly.</para>
        /// </summary>
        public static PrincipiaBinaryHealth Of(
            Version? assemblyVersion,
            PrincipiaConformanceVerdict verdict,
            PrincipiaWorkerDecision numerics)
        {
            var facts = new List<UplinkHealthFact>
            {
                VersionFact(assemblyVersion),
                new UplinkHealthFact("build", verdict.ActivePath),
                new UplinkHealthFact("instruction set", InstructionSetOf(verdict.Variant)),
                new UplinkHealthFact("release", verdict.ReleaseName),
                new UplinkHealthFact("interface hash", verdict.DescriptorSha256),
                new UplinkHealthFact(
                    "interface exports",
                    verdict.ExportCount.ToString(CultureInfo.InvariantCulture)),
                // One row for the whole numerics question, whichever way it went: a
                // worker that may run says what its answers are entitled to claim, and
                // one that may not says why there is nothing to claim. Both answer
                // "what would a trajectory computed here be", so splitting them across
                // two rows would leave one of them empty every time.
                new UplinkHealthFact("numerics", NumericsOf(numerics)),
            };

            return new PrincipiaBinaryHealth(
                verdict.State == PrincipiaConformance.Conformant
                    ? UplinkHealthState.Healthy
                    : UplinkHealthState.Degraded,
                DetailOf(verdict),
                facts);
        }

        private static UplinkHealthFact VersionFact(Version? assemblyVersion) =>
            new UplinkHealthFact("version", assemblyVersion?.ToString());

        private static string DetailOf(PrincipiaConformanceVerdict verdict)
        {
            switch (verdict.State)
            {
                case PrincipiaConformance.Conformant:
                    return "The loaded Principia build is one this uplink can compute against.";
                case PrincipiaConformance.UnknownRelease:
                    return "This Principia release has not been vetted here, so nothing computes "
                        + "against it. Report its interface hash below to have it added.";
                case PrincipiaConformance.Refused:
                    return "The loaded Principia build is not what it claims, so nothing computes "
                        + "against it. " + (verdict.Reason ?? string.Empty);
                default:
                    // The uplink does not adopt a NotEstablished verdict, so reaching
                    // here means the gate answered in a way this switch has not been
                    // taught. Saying so beats reporting a build we cannot describe.
                    return "Which Principia build the game loaded could not be established. "
                        + (verdict.Reason ?? string.Empty);
            }
        }

        /// <summary>
        /// Which of Principia's two builds is mapped, named by the thing that makes
        /// them differ rather than by the folder they ship in: the FMA build takes a
        /// different numeric path, which is the reason anybody reading this row cares
        /// which one is loaded.
        /// </summary>
        private static string? InstructionSetOf(PrincipiaBinaryVariant variant)
        {
            switch (variant)
            {
                case PrincipiaBinaryVariant.X64AvxFma:
                    return "AVX+FMA";
                case PrincipiaBinaryVariant.X64:
                    return "baseline x64";
                default:
                    return null;
            }
        }

        private static string NumericsOf(PrincipiaWorkerDecision numerics)
        {
            if (!numerics.MayRun)
            {
                return numerics.Reason;
            }

            switch (numerics.Provenance)
            {
                case PrincipiaNumericsProvenance.Reproduced:
                    return "the game's own arithmetic. " + numerics.Reason;
                case PrincipiaNumericsProvenance.ReproducedExceptTrig:
                    return "the game's own arithmetic, bar its choice of trigonometry. "
                        + numerics.Reason;
                case PrincipiaNumericsProvenance.IndependentEstimate:
                    return "an independent estimate rather than the game's own numbers. "
                        + numerics.Reason;
                default:
                    return numerics.Reason;
            }
        }
    }
}
