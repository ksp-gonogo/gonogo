using Sitrep.Contract;
using Xunit;

namespace Gonogo.KSP.Tests.Comms
{
    /// <summary>
    /// Stock CommNet's grading rule, exercised over the reading the backend
    /// hands it rather than over a live game: the whole rule is a function of
    /// one <see cref="CommsLinkState"/>, which is why it is carved out of the
    /// backend at all.
    ///
    /// <para>The distinction under test is the one a live install makes
    /// constantly and a naive rule collapses: a tick where the comms graph was
    /// not safe to read is NOT a degraded link. Collapsing them rates every
    /// scene settle as unusable, which is a video feed blacking out on a craft
    /// whose telemetry never stopped arriving.</para>
    /// </summary>
    public class CommNetDegradeTests
    {
        /// <summary>
        /// Nothing to read is UNRATED, not unusable. The tick says nothing about
        /// the link, so the grading says nothing either, and the id says so too
        /// rather than leaving a consumer to infer it from a missing number.
        /// </summary>
        [Fact]
        public void NothingToReadIsUnratedRatherThanTotallyDegraded()
        {
            var model = CommNetDegrade.From(null);

            Assert.Null(model.Level);
            Assert.Equal(CommsDegradeModels.UnknownModelId, model.ModelId);
        }

        /// <summary>
        /// A link the game reports as DOWN rates 1: fully degraded, as a real
        /// graded answer under stock's own name. Note it does not consult the
        /// strength field at all, which is deliberate: a disconnected craft's
        /// range fraction describes a link that is not there.
        /// </summary>
        [Fact]
        public void ADisconnectedLinkRatesUnusableWhateverTheStrengthFieldSays()
        {
            var model = CommNetDegrade.From(
                new CommsLinkState(connected: false, CommsControlGrade.None, signalStrength: 0.9));

            Assert.Equal(1.0, model.Level);
            Assert.Equal(CommNetDegrade.ModelId, model.ModelId);
        }

        /// <summary>
        /// A connected link grades on stock's range fraction, inverted so the
        /// scale runs the way the contract declares: a full-strength link is
        /// pristine, a marginal one is nearly unusable.
        /// </summary>
        [Theory]
        [InlineData(1.0, 0.0)]
        [InlineData(0.75, 0.25)]
        [InlineData(0.0, 1.0)]
        public void AConnectedLinkGradesOnTheRangeFractionInverted(double strength, double expected)
        {
            var model = CommNetDegrade.From(
                new CommsLinkState(connected: true, CommsControlGrade.Full, strength));

            Assert.Equal(expected, model.Level!.Value, precision: 10);
            Assert.Equal(CommNetDegrade.ModelId, model.ModelId);
        }

        /// <summary>
        /// A strength field outside 0..1 (which stock has no contract forbidding,
        /// and which a mod patching the field could produce) still yields a
        /// rating inside the scale, because the rule hands its arithmetic to
        /// <see cref="RatedDegradeModel"/> rather than publishing it raw. The
        /// clamp is the contract's, not this rule's, and this is the assertion
        /// that it is actually reached.
        /// </summary>
        [Theory]
        [InlineData(1.5)]
        [InlineData(-0.5)]
        [InlineData(double.NaN)]
        public void AnOutOfRangeStrengthNeverEscapesAsAnOutOfRangeRating(double strength)
        {
            var level = CommNetDegrade.From(
                new CommsLinkState(connected: true, CommsControlGrade.Full, strength)).Level;

            Assert.True(level == null || (level.Value >= 0.0 && level.Value <= 1.0));
        }
    }
}
