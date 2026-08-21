using Sitrep.Contract;

namespace Gonogo.KSP.Career
{
    /// <summary>
    /// A strategy, as the commitment sequence needs it: the two questions the
    /// game answers and the one field the sequence writes.
    ///
    /// <para>An interface rather than <c>Strategies.Strategy</c> itself so the
    /// ORDER of those four operations can be entered by a test. A real
    /// <c>Strategy</c> cannot: <c>CanBeActivated</c>'s first line dereferences
    /// <c>Administration.Instance</c>, and <c>Activate</c> calls
    /// <c>CanBeActivated</c>, so neither runs anywhere but the Administration
    /// screen. Same discipline as <c>PlanOwner</c> and <c>CareerRefusals</c>,
    /// and the same reason.</para>
    /// </summary>
    internal interface IStrategyCommitTarget
    {
        bool HasFactorSlider { get; }

        float Factor { get; set; }

        bool CanBeActivated(out string reason);

        bool Activate();
    }

    /// <summary>
    /// Committing to a strategy without leaving the save changed when the game
    /// says no.
    ///
    /// <para><c>Strategy.Factor</c> is a plain persisted setter: the commitment
    /// level the player is on the hook for, written to the save. The console set
    /// it and then asked, so a refused activation left the commitment changed
    /// with no activation to show for it, and nothing told the operator. Stock's
    /// Administration UI moves its slider only inside its own
    /// <c>CanBeActivated</c>-guarded flow.</para>
    ///
    /// <para>It cannot ask first either: the commit-level arm of
    /// <c>CanBeActivated</c> tests <c>Factor</c>, and every up-front cost scales
    /// with it, so the gate has to see the factor the operator asked for. Write
    /// it, ask, put it back if the answer was no.</para>
    /// </summary>
    internal static class StrategyCommit
    {
        /// <summary>
        /// Commit <paramref name="strategy"/> at <paramref name="factor"/>, or
        /// refuse in the game's own words with nothing changed.
        ///
        /// <para>A <paramref name="factor"/> of zero or less means "leave the
        /// strategy's own", which is the command's documented best-effort
        /// contract: strategies with no slider activate at their fixed
        /// commitment.</para>
        /// </summary>
        public static CommandResult Activate(IStrategyCommitTarget strategy, double factor)
        {
            var wanted = strategy.HasFactorSlider && factor > 0.0;
            var previous = strategy.Factor;
            if (wanted)
            {
                strategy.Factor = Clamp01(factor);
            }

            if (!strategy.CanBeActivated(out var reason))
            {
                if (wanted) strategy.Factor = previous;
                return CommandResult.Fail(CommandErrorCode.WrongState, reason);
            }

            if (strategy.Activate())
            {
                return CommandResult.Ok();
            }

            // CanBeActivated said yes and Activate still said no, so nothing
            // happened and the commitment must not survive it either.
            if (wanted) strategy.Factor = previous;
            return CommandResult.Fail(CommandErrorCode.WrongState, "the strategy is not eligible");
        }

        /// <summary>
        /// <c>Factor</c> is a 0..1 fraction and its setter does not bound
        /// itself, so an out-of-range request would be persisted verbatim.
        /// (<c>Mathf.Clamp01</c> spelled out here because this file carries no
        /// Unity reference.)
        /// </summary>
        private static float Clamp01(double value)
        {
            if (value < 0.0) return 0f;
            if (value > 1.0) return 1f;
            return (float)value;
        }
    }
}
