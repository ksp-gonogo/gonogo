using System;

namespace Sitrep.Contract;

/// <summary>
/// The <c>derivedCurrency</c> capability's per-provider interface: one mod's
/// way of keeping whatever it derives from a currency change withheld for
/// exactly as long as the change itself is.
///
/// <para>When signal delay is on, the core delays a currency change by
/// neutralising it when it is earned and re-applying it once the vessel's
/// light-time says the news could have arrived. A mod that computes something
/// of its own from that change computes it at earn time, before the neutralise,
/// and nothing tells it to revisit the result. Without a withholder, the derived
/// quantity moves while the primary one is still withheld, and an operator
/// watching it learns of the arrival early. The core says when it neutralised
/// and what; each implementation decides what that means for the quantity its
/// mod derived.</para>
///
/// <para>The capability is shared, not exclusive: more than one installed mod
/// can derive from the same change, and every one is called. A stock install
/// derives nothing and registers none.</para>
///
/// <para>The two calls are a pair around the core's own neutralise, and the
/// order is guaranteed: <see cref="ObserveBeforeDerivation"/> runs off the
/// modifier query that precedes the change, so it is the last moment before any
/// mod can have derived anything from it, and <see cref="WithholdDerived"/> runs
/// immediately after the core has neutralised the primary balance.</para>
///
/// <para><b>Observe, do not compute.</b> An implementation reads its own
/// derived quantities in the first call and puts them back in the second; it
/// does not re-derive what the mod would have charged. Re-deriving means
/// holding a second copy of the mod's pricing, which drifts, and pricing against
/// state the earn has already moved.</para>
///
/// <para><b>Nothing is queued for the reveal.</b> The reveal re-applies the
/// primary change through the game's own <c>AddFunds</c>/<c>AddScience</c>/<c>AddReputation</c>,
/// which fires the same events the earn did, so the mod derives again by itself,
/// once, priced against the career the operator has when the news lands. An
/// implementation that also replayed its own withheld amount would double
/// it.</para>
/// <internal>
/// A neutralise is a balance write, which fires no currency query, which is why
/// a deriving mod is never told on its own. The sibling exclusive capability is
/// "delayedScience" in DelayedScience.cs. The interface closes over primitives
/// and one string only.
/// </internal>
/// </summary>
/// <category>Host and Kernel</category>
public interface IDerivedCurrencyWithholder : ISitrepProvider
{
    /// <summary>
    /// Where this implementation reports what it could not do. The core installs
    /// a sink that reaches the game log before it makes either call below, so an
    /// implementation that declines to withhold something can say why somewhere
    /// the person running the game can read it.
    ///
    /// <para>It is on the interface because an implementation lives in an
    /// Uplink assembly, which references no game or engine assembly and so has
    /// no log of its own.</para>
    ///
    /// <para>Initialise it to a no-op, so the implementation still runs under a
    /// host that installs no sink.</para>
    /// </summary>
    Action<string> Diagnostic { get; set; }

    /// <summary>
    /// A change to <paramref name="primaryCurrency"/> has been ASKED for and
    /// nothing has derived from it yet: record whatever derived quantities this
    /// implementation is responsible for, against <paramref name="ut"/>.
    ///
    /// <para>Called for every such query, whether or not the change turns out to
    /// be delayed, because whether it is delayed is not known this early. An
    /// implementation should be cheap and must not write game state.</para>
    /// </summary>
    void ObserveBeforeDerivation(string primaryCurrency, double ut);

    /// <summary>
    /// The core has just neutralised a <paramref name="primaryCurrency"/> change
    /// of <paramref name="baseAmount"/> at <paramref name="ut"/>: put back
    /// whatever this implementation's mod derived from it in the meantime.
    ///
    /// <para>Idempotent for a given <paramref name="ut"/>: one earn can reach
    /// the core through more than one game event, so this may be called more
    /// than once for the same change, and putting a recorded value back twice
    /// must land in the same place as putting it back once.</para>
    ///
    /// <para>An implementation with no observation for <paramref name="ut"/>
    /// must do NOTHING and report it through <see cref="Diagnostic"/>, rather
    /// than restore an older reading. Restoring an older reading erases a currency movement that had nothing to do with this
    /// change.</para>
    /// </summary>
    void WithholdDerived(string primaryCurrency, double baseAmount, double ut);
}

/// <summary>
/// The <c>derivedCurrency</c> capability id and the primary-currency names
/// passed to <see cref="IDerivedCurrencyWithholder"/>. Use these constants
/// rather than literals: a second spelling of one identity means the capability
/// never elects.
/// </summary>
/// <category>Host and Kernel</category>
public static class DerivedCurrencyCapability
{
    /// <summary>The capability id, <c>"derivedCurrency"</c>.</summary>
    public const string CapabilityId = "derivedCurrency";

    /// <summary>The primary-currency name for career funds, <c>"funds"</c>. The three names are lowercase and match the currency-delay ledger.</summary>
    public const string Funds = "funds";

    /// <summary>The primary-currency name for science points, <c>"science"</c>.</summary>
    public const string Science = "science";

    /// <summary>The primary-currency name for reputation, <c>"reputation"</c>.</summary>
    public const string Reputation = "reputation";
}
