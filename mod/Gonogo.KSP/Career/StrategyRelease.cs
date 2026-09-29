using System;
using Sitrep.Contract;

namespace Gonogo.KSP.Career
{
    /// <summary>
    /// A strategy, as ending it needs it: the call, and the state that says
    /// whether the call took.
    /// </summary>
    internal interface IStrategyReleaseTarget
    {
        bool IsActive { get; }

        bool Deactivate();
    }

    /// <summary>
    /// Ending a strategy, answered by what happened to it rather than by how the
    /// call returned.
    ///
    /// <para>A career mod's <c>Deactivate</c> can throw AFTER it has done the
    /// thing. RP-1's <c>StrategyRP0.DeactivateOverride</c> charges the removal
    /// reputation, clears <c>isActive</c> and unregisters the effects, then walks
    /// a tail of unguarded bookkeeping (build rates, upkeep, program deadlines,
    /// the career log, KAC alarms). A throw from that tail left the leader gone
    /// and the reputation spent while the command reported
    /// <c>commandUnavailable</c> and latched itself off for the session. So a
    /// throw with the strategy no longer active is a release that happened, and
    /// only a throw with it still active is a failure.</para>
    /// </summary>
    internal static class StrategyRelease
    {
        /// <summary>
        /// End <paramref name="strategy"/>. <paramref name="afterEffect"/> hears
        /// a throw that came after the strategy was released, so the unfinished
        /// bookkeeping is logged rather than lost; a throw with the strategy still
        /// active propagates untouched.
        /// </summary>
        public static CommandResult Deactivate(IStrategyReleaseTarget strategy, Action<Exception> afterEffect)
        {
            bool released;
            try
            {
                released = strategy.Deactivate();
            }
            catch (Exception ex) when (!strategy.IsActive)
            {
                afterEffect(ex);
                return CommandResult.Ok();
            }

            return released
                ? CommandResult.Ok()
                : CommandResult.Fail(CommandErrorCode.WrongState, CareerRefusals.DeactivateRefusal(null));
        }
    }
}
