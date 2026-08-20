namespace Sitrep.Contract;

// ─────────────────────────────────────────────────────────────────────────────
// Delayed science crediting as a Kernel-elected capability, the same shape
// "science" / "comms" / "actionGroups" already use (ScienceCapability.cs,
// Comms.cs, ActionGroupsBackend.cs).
//
//   • ONE exclusive capability "delayedScience" whose active instance is an
//     IDelayedScienceSink (this file).
//   • A core registrar (mod/Gonogo.KSP/CurrencyEventUplink.cs) OWNS the
//     capability and ships the currency-delay sink as its Vanilla factory, so
//     the capability is satisfied on every install.
//   • An Uplink that OBSERVES science crediting a third-party mod does its own
//     way resolves the sink through host.Kernel and hands increments to it. It
//     needs no reference to the implementing assembly, which is the whole
//     reason this interface exists here rather than staying a static call into
//     Gonogo.KSP: that reference put five unpublished assemblies on the calling
//     Uplink's compile surface, and an outside author cannot obtain any of them
//     (docs/uplink-isolation.md).
//
// Closure is zero: the one method's parameters are primitives, so nothing new
// arrives in this assembly alongside it.
// ─────────────────────────────────────────────────────────────────────────────

/// <summary>
/// The "delayedScience" capability's active-instance interface: the
/// source-agnostic entry point a per-increment science source hands its raw
/// crediting events to, so a delayed credit can be produced without the source
/// knowing anything about the aggregator, the pending-credit ledger, or how a
/// reveal-UT is derived.
///
/// <para>Deliberately primitives-only. The implementation resolves the vessel
/// itself, from <paramref name="vesselId"/>, because only a LIVE vessel has a
/// CommNet route and a route is the only thing that produces a delay: a handle
/// to a vessel the caller happens to hold says nothing about routability. An
/// earlier signature took a stock <c>ProtoVessel</c> alongside the id and
/// documented the light-time as coming from it, which was never true.</para>
/// </summary>
public interface IDelayedScienceSink
{
    /// <summary>
    /// Records one science increment earned by a vessel: its identity, the raw
    /// amount, the UT it was earned at, and an opaque origin label for the
    /// pending-credit row. Implementations are no-ops rather than throwers for
    /// a non-positive amount, an empty id, or a currency-delay subsystem that
    /// is not currently active (no loaded game).
    /// </summary>
    void RecordDelayedScienceIncrement(string vesselId, double amount, double ut, string originDescription);
}

/// <summary>
/// The capability id both halves name. It lives HERE, not on the core
/// registrar, because both halves must spell it identically and only one of them
/// is published: the older elections keep their id constant in the unpublished
/// Sitrep.Host, which leaves each Uplink re-declaring the string as its own
/// constant with a test to pin the two equal. Two spellings of one identity
/// drift silently, the capability simply never elects. A capability an Uplink is
/// expected to resolve should not need that test at all.
/// </summary>
public static class DelayedScienceCapability
{
    public const string CapabilityId = "delayedScience";
}
