using Sitrep.Contract;
#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace GonogoKerbalismUplink;

// ─────────────────────────────────────────────────────────────────────────────
// The Kerbalism namespace of reliability.summary's provider extension bag.
//
// reliability.* is a Kernel-ELECTED capability: one shared payload shape
// (Sitrep.Contract/Reliability.cs) that whichever backend won the election fills.
// Its fields are a hand-curated core superset, which works only because the core
// maintainer already knew about both providers. This type is the other route, the
// one that needs no core PR: Kerbalism's own sub-tree, declared and typed HERE,
// carried under the provider id "kerbalism" in ReliabilitySummary.Extensions. See
// Sitrep.Contract/ProviderExtensions.cs for the mechanism in full.
//
// TYPING-ONLY, exactly like KerbalismPayloads.cs: this adds no wire bytes. The
// wire is written by JsonWriter walking the untyped value tree
// KerbalismReliabilityMap builds, and the two are kept honest by
// ReliabilityExtensionWireTests (which serialises the real map through the real
// EnvelopeCodec) plus the golden fixture the client's own test reads back.
//
// WHY THESE THREE, and why at vessel level rather than per part. Every field
// Kerbalism's per-part ReliabilityInfo exposes (partId/title/group/broken/
// critical/mtbf/rel_ignitions/rel_duration/NeedsMaintenance) is ALREADY mapped
// into the core superset, so a per-part extension could only restate what is
// there. The vessel level is the real gap: the shared summary's only quantity is
// WorstReliabilityFraction, which TestFlight fills and Kerbalism cannot (Kerbalism
// models consumption and mean time between failures, not a live probability). So
// the three below are the at-a-glance numbers a Kerbalism operator actually has,
// derived from the same per-part list the Uplink already reads.
// ─────────────────────────────────────────────────────────────────────────────

/// <summary>
/// Kerbalism's vessel-level reliability rollup: the <c>extensions["kerbalism"]</c>
/// sub-tree of <c>reliability.summary</c>. Read client-side through this Uplink's
/// own <c>readKerbalismReliabilityExt</c>, never by reaching into the bag and
/// casting at a call site.
///
/// <para>Absent entirely when Kerbalism is not the elected backend, and when
/// <c>Features.Reliability</c> is off (the summary reports <c>Unmodeled</c> and
/// there is no per-part list to roll up).</para>
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class KerbalismReliabilityExt
{
    /// <summary>
    /// The shortest mean-time-between-failures on the vessel: Kerbalism's
    /// at-a-glance "what fails first" number, the counterpart to the TestFlight-only
    /// <c>WorstReliabilityFraction</c> on the shared summary. Null when the vessel
    /// has no modelled parts.
    /// </summary>
    [SitrepUnit(Units.Hours)]
    public double? WorstMtbfHours { get; set; }

    /// <summary>How many modelled parts are currently broken.</summary>
    [SitrepUnit(Units.Count)]
    public int? BrokenPartCount { get; set; }

    /// <summary>
    /// How many modelled parts report <c>NeedsMaintenance</c>: the engineer's
    /// work list, distinct from <see cref="BrokenPartCount"/> (a part can be due
    /// maintenance long before it fails).
    /// </summary>
    [SitrepUnit(Units.Count)]
    public int? MaintenanceDueCount { get; set; }
}
