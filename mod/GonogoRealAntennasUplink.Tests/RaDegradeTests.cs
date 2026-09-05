using Gonogo.RealAntennasUplink;
using Sitrep.Contract;
using Xunit;

namespace GonogoRealAntennasUplink.Tests
{
    /// <summary>
    /// RealAntennas' grading rule, and the reason it is a separate rule rather
    /// than shared code that happens to be called twice.
    ///
    /// <para>RA fills the strength field with spare room on a negotiated
    /// data-rate ladder; stock fills the same field with how far through an
    /// antenna range curve the link sits, and applies a plasma multiplier RA does
    /// not. Two quantities, one field, and every consumer that derived a quality
    /// from it was silently computing a different curve per install. What makes
    /// <c>comms.degrade</c> different is not the arithmetic, which is the same
    /// expression here, it is that the ANSWER ARRIVES NAMED. The name is what
    /// this file pins.</para>
    /// </summary>
    public class RaDegradeTests
    {
        /// <summary>
        /// The rating says which rule produced it, and that name is RA's own
        /// rather than the stock one. A consumer keying a bitrate ladder on the
        /// number can therefore see which grading it is standing on, which is
        /// the whole difference from reading the raw strength field.
        /// </summary>
        [Fact]
        public void TheRatingNamesRAsOwnRuleAndNotTheStockOne()
        {
            var model = RaDegrade.From(
                new CommsLinkState(connected: true, CommsControlGrade.Full, signalStrength: 0.6));

            Assert.Equal("realantennas-rate-headroom", model.ModelId);
            Assert.NotEqual("commnet-range-fraction", model.ModelId);
            Assert.Equal(0.4, model.Level!.Value, precision: 10);
        }

        /// <summary>
        /// Nothing to read is UNRATED, not unusable: same discipline as the stock
        /// rule, and for the same reason. A tick where the link could not be read
        /// says nothing about the link, and rating it 1 would black a feed out on
        /// a craft whose telemetry never stopped arriving.
        /// </summary>
        [Fact]
        public void NothingToReadIsUnratedRatherThanTotallyDegraded()
        {
            var model = RaDegrade.From(null);

            Assert.Null(model.Level);
            Assert.Equal(CommsDegradeModels.UnknownModelId, model.ModelId);
        }

        /// <summary>
        /// A link RA reports as down rates 1 without consulting the headroom
        /// field, which has no meaning once no rate closes at all.
        /// </summary>
        [Fact]
        public void ADisconnectedLinkRatesUnusableWhateverTheHeadroomFieldSays()
        {
            var model = RaDegrade.From(
                new CommsLinkState(connected: false, CommsControlGrade.None, signalStrength: 0.9));

            Assert.Equal(1.0, model.Level);
            Assert.Equal(RaDegrade.ModelId, model.ModelId);
        }

        /// <summary>
        /// A headroom fraction above 1 is the realistic out-of-range case for
        /// this backend specifically (the ladder's top rung with room to spare),
        /// and it must not escape as a rating above the declared scale.
        /// </summary>
        [Theory]
        [InlineData(1.5)]
        [InlineData(-0.5)]
        [InlineData(double.NaN)]
        public void AnOutOfRangeHeadroomNeverEscapesAsAnOutOfRangeRating(double headroom)
        {
            var level = RaDegrade.From(
                new CommsLinkState(connected: true, CommsControlGrade.Full, headroom)).Level;

            Assert.True(level == null || (level.Value >= 0.0 && level.Value <= 1.0));
        }
    }
}
