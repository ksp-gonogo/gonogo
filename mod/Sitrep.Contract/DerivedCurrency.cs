namespace Sitrep.Contract;

// ─────────────────────────────────────────────────────────────────────────────
// Withholding a DERIVED currency, as a shared Kernel capability, alongside the
// exclusive "delayedScience" one in DelayedScience.cs.
//
// THE DEFECT THIS EXISTS FOR. The currency-delay subsystem delays a primary
// currency change by neutralising it at earn time and re-applying it when the
// vessel's light-time says the news could have arrived. A third-party mod that
// computes something of its own FROM that change computes it at earn time, off
// the same game event, before the neutralise has happened - and a neutralise is
// a balance write, which fires no currency query, so the mod is never told to
// revisit its answer. The derived quantity then moves while the primary one is
// still withheld, and an operator watching the derived quantity knows the
// arrival before the model says they can.
//
// It is not an RP-1 problem, it is the shape of every derived quantity. So the
// core says WHEN it neutralised and WHAT, and each mod's own arm decides what
// that means for whatever it derived. The core names no mod, and an arm needs no
// reference to the assembly the interceptor lives in.
//
// SHARED, not exclusive: more than one installed mod can derive from the same
// change, and every one of them has to be told. No vanilla either - a stock
// install derives nothing and should activate nothing.
//
// Closure is zero: primitives and one string only.
// ─────────────────────────────────────────────────────────────────────────────

/// <summary>
/// The "derivedCurrency" capability's per-provider interface: one mod's arm for
/// keeping whatever it derives from a currency change withheld for exactly as
/// long as the change itself is.
///
/// <para>The two calls are a PAIR around the core's own neutralise, and the
/// order is guaranteed: <see cref="ObserveBeforeDerivation"/> runs off the
/// modifier query that precedes the change, so it is the last moment before any
/// mod can have derived anything from it, and <see cref="WithholdDerived"/> runs
/// immediately after the core has neutralised the primary balance.</para>
///
/// <para><b>Observe, do not compute.</b> An implementation is meant to read its
/// own derived quantities in the first call and put them back in the second, not
/// to re-derive what the mod would have charged. Re-deriving means holding a
/// second copy of the mod's pricing, which drifts, and it means pricing against
/// state the earn has already moved.</para>
///
/// <para><b>Nothing is enqueued for the reveal.</b> The reveal re-applies the
/// primary change through the game's own AddX, which fires the same events the
/// earn did, so the mod derives again by itself - once, and priced against the
/// career the operator actually has when the news lands. An implementation that
/// also replayed its own withheld amount would double it.</para>
/// </summary>
public interface IDerivedCurrencyWithholder : ISitrepProvider
{
    /// <summary>
    /// A change to <paramref name="primaryCurrency"/> has been ASKED for and
    /// nothing has derived from it yet: record whatever derived quantities this
    /// arm is responsible for, against <paramref name="ut"/>.
    ///
    /// <para>Called for every such query, whether or not the change turns out to
    /// be delayed, because whether it is delayed is not known this early. An
    /// implementation should be cheap and must not write game state.</para>
    /// </summary>
    void ObserveBeforeDerivation(string primaryCurrency, double ut);

    /// <summary>
    /// The core has just neutralised a <paramref name="primaryCurrency"/> change
    /// of <paramref name="baseAmount"/> at <paramref name="ut"/>: put back
    /// whatever this arm's mod derived from it in the meantime.
    ///
    /// <para>Idempotent for a given <paramref name="ut"/>: one earn can reach
    /// the core through more than one game event, so this may be called more
    /// than once for the same change, and putting a recorded value back twice
    /// must land in the same place as putting it back once.</para>
    ///
    /// <para>An implementation with no observation for <paramref name="ut"/>
    /// must do NOTHING and say so, rather than restore an older reading. A stale
    /// restore erases a currency movement that had nothing to do with this
    /// change.</para>
    /// </summary>
    void WithholdDerived(string primaryCurrency, double baseAmount, double ut);
}

/// <summary>
/// The capability id and the primary-currency names both halves name, here for
/// the reason <see cref="DelayedScienceCapability"/> spells out: two spellings
/// of one identity drift silently and the capability simply never elects.
/// </summary>
public static class DerivedCurrencyCapability
{
    public const string CapabilityId = "derivedCurrency";

    /// <summary>The primary currency a withhold names. Lowercase, and the same three the currency-delay ledger carries.</summary>
    public const string Funds = "funds";

    public const string Science = "science";

    public const string Reputation = "reputation";
}
