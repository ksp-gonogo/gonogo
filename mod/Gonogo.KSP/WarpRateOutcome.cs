using Sitrep.Contract;

namespace Gonogo.KSP
{
    /// <summary>
    /// What the game actually warped at, against what was asked for.
    ///
    /// <para><b>What was wrong.</b> <c>SetWarp</c> bounds-checked the index
    /// against <c>TimeWarp.fetch.warpRates.Length</c> and returned <c>Ok()</c>
    /// unconditionally, on a doc comment claiming <c>TimeWarp.SetRate</c> "does
    /// no bounds checking of its own". It does two:
    /// <c>Mathf.Clamp(rate_index, 0, warpRates.Length)</c>, and then
    /// <c>setRate</c> runs <c>getMaxOnRailsRateIdx</c>, which clamps to the
    /// body's altitude limit (and to a kerbal on a ladder, and to the physics
    /// ceiling) and posts its own screen message. So an operator asking for
    /// 100,000x at 20 km over Kerbin got a success and 1x, and the console's
    /// warp readout disagreed with its own command result until the next sample
    /// landed.</para>
    ///
    /// <para>The authority for the answer is the game AFTER the call:
    /// <c>setRate</c> assigns <c>current_rate_index</c> synchronously and
    /// returns <c>num == rateIdx</c> itself, so <c>TimeWarp.CurrentRateIndex</c>
    /// read back is what happened. Asking beforehand would mean reproducing
    /// <c>getMaxOnRailsRateIdx</c>, which is private and covers more than
    /// altitude.</para>
    /// </summary>
    internal static class WarpRateOutcome
    {
        /// <summary>
        /// The refusal when KSP settled somewhere other than where the command
        /// asked, or null when it honoured the request.
        ///
        /// <para>No <c>Detail</c>. KSP's own sentences for this name a required
        /// altitude this side never sees, and the comparison says the whole
        /// thing without any prose: the rate asked for against the rate
        /// allowed.</para>
        /// </summary>
        public static CommandResult? Refusal(
            int requestedIndex, int settledIndex, double requestedRate, double settledRate)
        {
            if (settledIndex == requestedIndex) return null;

            return CommandResult.Fail(
                CommandErrorCode.LimitReached,
                new LimitBreach
                {
                    Quantity = "warpRate",
                    Limit = settledRate,
                    Actual = requestedRate,
                    Unit = Units.Dimensionless,
                });
        }
    }
}
