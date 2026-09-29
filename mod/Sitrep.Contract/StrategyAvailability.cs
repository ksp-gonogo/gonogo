namespace Sitrep.Contract;

/// <summary>
/// The "strategyAvailability" capability's per-provider interface: one career
/// mod's own rule for when a strategy may not be committed to, where KSP's
/// activation gate cannot see it.
///
/// <para>A career mod can keep a rule outside <c>Strategy.CanBeActivated</c>
/// and enforce it by hiding the strategy from its own screen instead. The core
/// asks KSP's gate and nothing else, so without this a strategy the career
/// would never offer reads as eligible, and <c>career.strategy.activate</c>
/// would commit to it. Every refusal an implementation returns is carried on
/// the roster as that strategy's <c>activateBlockedReason</c> and refuses the
/// activate command in the same words.</para>
///
/// <para>SHARED rather than elected: two installed mods can each hold a rule,
/// and every one of them has to be asked. A stock install holds none, so there
/// is no vanilla.</para>
/// </summary>
public interface IStrategyAvailability : ISitrepProvider
{
    /// <summary>
    /// Why <paramref name="strategyId"/> may not be committed to right now under
    /// this mod's own rules, or <c>null</c> when this mod has nothing against
    /// it. The id is the one <c>career.status.strategies.all[].id</c> carries.
    ///
    /// <para>Called for every inactive strategy on every roster capture, so an
    /// implementation must be cheap and must not write game state. A throw is
    /// reported and read as "nothing against it", never as a refusal.</para>
    /// </summary>
    StrategyUnavailability? Unavailable(string strategyId);
}

/// <summary>
/// A career mod's refusal of one strategy, in its own words.
/// </summary>
public sealed class StrategyUnavailability
{
    /// <summary>
    /// The mod's own sentence for the rule that refuses. Carried verbatim to the
    /// operator, so it should read as the career's screen would put it, and it
    /// should not print a date: <see cref="AvailableFromUt"/> carries the time.
    /// </summary>
    public string Reason { get; set; } = "";

    /// <summary>
    /// The instant the refusal lapses on its own, or <c>null</c> when it does not
    /// lapse with time.
    /// </summary>
    public double? AvailableFromUt { get; set; }
}

/// <summary>
/// The capability id both halves name, kept in one place so the declaration
/// and a provider's registration cannot drift apart.
/// </summary>
public static class StrategyAvailabilityCapability
{
    /// <summary>The id a provider registers under with the <see cref="Kernel"/>.</summary>
    public const string CapabilityId = "strategyAvailability";
}
