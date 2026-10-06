namespace Sitrep.Contract;

/// <summary>
/// Where an Uplink hands science a mod credits in increments, so Gonogo credits
/// it after the signal delay from the earning vessel. The active instance of
/// <see cref="DelayedScienceCapability"/>.
///
/// <para>Gonogo registers a default sink, so once capabilities are resolved it
/// is present on every install; before that, resolving it through
/// <see cref="IUplinkHost.Kernel"/> returns nothing. An Uplink that sees a mod
/// crediting science its own way resolves the sink and hands it each
/// increment.</para>
///
/// <para>It takes the vessel by id and finds the live vessel itself, since only
/// a live vessel has a route home to measure the delay over.</para>
/// <internal>
/// The core registrar is <c>Gonogo.KSP.CurrencyEventUplink</c>, which ships the
/// currency-delay sink as the capability's Vanilla factory.
/// </internal>
/// </summary>
/// <category>Uplink API</category>
public interface IDelayedScienceSink : ISitrepProvider
{
    /// <summary>
    /// Records one science increment earned by a vessel. Does nothing, rather
    /// than throwing, for a non-positive amount, an empty id, or when no game is
    /// loaded.
    /// </summary>
    /// <param name="vesselId">The earning vessel, as KSP's <c>Vessel.id</c> GUID string.</param>
    /// <param name="amount">The raw science amount earned.</param>
    /// <param name="ut">The universal time it was earned at.</param>
    /// <param name="originDescription">An opaque label shown on the pending-credit row.</param>
    void RecordDelayedScienceIncrement(string vesselId, double amount, double ut, string originDescription);
}

/// <summary>
/// The capability id an <see cref="IDelayedScienceSink"/> is resolved under. Use
/// this constant rather than writing the string: a mismatched id fails
/// silently, as a capability that never resolves.
/// </summary>
/// <category>Uplink API</category>
public static class DelayedScienceCapability
{
    /// <summary>The capability id, <c>"delayedScience"</c>: resolve an <see cref="IDelayedScienceSink"/> under exactly this string.</summary>
    public const string CapabilityId = "delayedScience";
}
