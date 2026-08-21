using Sitrep.Contract;
using Xunit;

namespace Gonogo.KSP.Tests.Warp
{
    /// <summary>
    /// Asking for a warp rate the game clamps away used to come back green.
    ///
    /// <para><c>TimeWarp.SetRate</c> clamps the index and then <c>setRate</c>
    /// runs <c>getMaxOnRailsRateIdx</c>, which clamps again to the body's
    /// altitude limit and posts its own screen message. The console returned
    /// <c>Ok()</c> regardless, so its warp readout and its command result
    /// disagreed until the next sample landed.</para>
    /// </summary>
    public class WarpRateOutcomeTests
    {
        [Fact]
        public void ARateTheGameHonouredIsNotRefused()
        {
            Assert.Null(WarpRateOutcome.Refusal(
                requestedIndex: 4, settledIndex: 4, requestedRate: 1000, settledRate: 1000));
        }

        /// <summary>
        /// The bug: 100,000x asked for at 20 km over Kerbin, 1x delivered.
        /// </summary>
        [Fact]
        public void ARateTheGameClampedAwayIsRefused()
        {
            var refusal = WarpRateOutcome.Refusal(
                requestedIndex: 7, settledIndex: 0, requestedRate: 100_000, settledRate: 1);

            Assert.NotNull(refusal);
            Assert.False(refusal!.Success);
            Assert.Equal(CommandErrorCode.LimitReached, refusal.ErrorCode);
        }

        /// <summary>
        /// The operator needs to know what they got, not only that they did not
        /// get what they asked for.
        /// </summary>
        [Fact]
        public void TheRefusalCarriesTheRateAskedForAgainstTheRateAllowed()
        {
            var refusal = WarpRateOutcome.Refusal(
                requestedIndex: 7, settledIndex: 3, requestedRate: 100_000, settledRate: 50);

            Assert.Equal(100_000, refusal!.Breach!.Actual);
            Assert.Equal(50, refusal.Breach.Limit);
            Assert.Equal(Units.Dimensionless, refusal.Breach.Unit);
        }

        /// <summary>
        /// KSP raises the rate too, when a command asks for less than the mode
        /// switch it triggers. A rate that is not the one asked for is still not
        /// the one asked for.
        /// </summary>
        [Fact]
        public void SettlingAboveTheRequestIsAlsoNotWhatWasAskedFor()
        {
            Assert.NotNull(WarpRateOutcome.Refusal(
                requestedIndex: 1, settledIndex: 2, requestedRate: 5, settledRate: 10));
        }
    }
}
