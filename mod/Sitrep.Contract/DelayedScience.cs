namespace Sitrep.Contract;

/// <summary>
/// The "delayedScience" capability's active-instance interface: the
/// source-agnostic entry point a per-increment science source hands its raw
/// crediting events to, so a delayed credit can be produced without the source
/// knowing anything about the aggregator, the pending-credit ledger, or how a
/// reveal-UT is derived.
///
/// <para>Core registers a default sink, so once capabilities are resolved the
/// capability is satisfied on every install; before that, resolving through
/// <c>host.Kernel</c> returns nothing. An Uplink that observes a
/// third-party mod crediting science its own way resolves the sink and hands
/// each increment to it, with no reference to the implementing
/// assembly.</para>
///
/// <para>Deliberately primitives-only. The implementation resolves the vessel
/// itself, from the <c>vesselId</c> it is handed, because only a LIVE vessel has a
/// CommNet route and a route is the only thing that produces a delay: a handle
/// to a vessel the caller happens to hold says nothing about routability.</para>
/// <internal>
/// The core registrar is <c>Gonogo.KSP.CurrencyEventUplink</c>, which ships the
/// currency-delay sink as the capability's Vanilla factory.
/// </internal>
/// </summary>
/// <category>Uplink API</category>
public interface IDelayedScienceSink : ISitrepProvider
{
    /// <summary>
    /// Records one science increment earned by a vessel: its identity, the raw
    /// amount, the UT it was earned at, and an opaque origin label for the
    /// pending-credit row. Implementations are no-ops rather than throwers for
    /// a non-positive amount, an empty id, or a currency-delay subsystem that
    /// is not currently active (no loaded game).
    /// </summary>
    /// <param name="vesselId">The earning vessel, as KSP's <c>Vessel.id</c> GUID string.</param>
    /// <param name="amount">The raw science amount earned.</param>
    /// <param name="ut">The universal time it was earned at.</param>
    /// <param name="originDescription">An opaque label shown on the pending-credit row.</param>
    void RecordDelayedScienceIncrement(string vesselId, double amount, double ut, string originDescription);
}

/// <summary>
/// The capability id both the registrar and a resolving Uplink name. It lives
/// here, in the published contract, so both spell it from one constant: two
/// spellings of one identity drift silently, and the capability simply never
/// resolves.
/// </summary>
/// <category>Uplink API</category>
public static class DelayedScienceCapability
{
    /// <summary>The capability id, <c>"delayedScience"</c>: resolve an <see cref="IDelayedScienceSink"/> under exactly this string.</summary>
    public const string CapabilityId = "delayedScience";
}
