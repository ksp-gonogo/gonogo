using System;
using Gonogo.KSP;
using Sitrep.Contract;
using Xunit;

namespace Gonogo.KSP.Tests.Comms
{
    /// <summary>
    /// Stock's reach rule, pinned against the shipped <c>Assembly-CSharp</c>.
    ///
    /// <para><c>CommNetwork.SetNodeConnection</c> requires each end to carry
    /// some non-zero power, then tries <c>IRangeModel.InRange</c> over three
    /// pairings and connects if any clears: relay-to-relay, relay-to-transmit,
    /// transmit-to-relay. There is no fourth. These tests exist because each of
    /// those clauses is a place where "close enough" produces a plausible wrong
    /// number rather than an obvious failure, and because the whole point of
    /// putting reach on the seam is that this rule is stock's and NOT
    /// everyone's.</para>
    /// </summary>
    public class CommNetReachTests
    {
        /// <summary>
        /// A stand-in for the game's range model: reach is the product of the
        /// two powers, which is monotone in both and lets a test say which
        /// pairing won by reading the number back.
        /// </summary>
        private static Func<double, double, double> Product() => (a, b) => a * b;

        private static ICommsReachModel Model(
            double fromRelay,
            double fromTransmit,
            double toRelay,
            double toTransmit,
            double offset = 0.0) =>
            CommNetReach.Model(fromRelay, fromTransmit, toRelay, toTransmit, offset, Product());

        [Fact]
        public void TheBestOfStocksThreePairingsWins()
        {
            // Relay-to-relay is 2*3=6; relay-to-transmit is 2*100=200;
            // transmit-to-relay is 1*3=3. The middle one is the reach.
            var model = Model(fromRelay: 2.0, fromTransmit: 1.0, toRelay: 3.0, toTransmit: 100.0);

            Assert.Equal(200.0, model.MaxRangeMeters);
            Assert.Equal(CommNetReach.ModelId, model.ModelId);
        }

        /// <summary>
        /// The pairing stock does not have. Two transmit-only nodes never link
        /// at any distance, so their reach is a genuine zero rather than
        /// 5*7=35: a fourth pairing would hand back a number for a pair the
        /// game refuses outright.
        /// </summary>
        [Fact]
        public void TwoTransmitOnlyNodesReachNothing()
        {
            var model = Model(fromRelay: 0.0, fromTransmit: 5.0, toRelay: 0.0, toTransmit: 7.0);

            Assert.Equal(0.0, model.MaxRangeMeters);
        }

        /// <summary>
        /// Zero and absent are different answers, and this is the one place the
        /// difference is load-bearing: a pair stock will not connect has a
        /// MEASURED maximum of zero, and reporting it as absent would tell the
        /// predictor "no rule declared" and quietly restore the over-promise.
        /// </summary>
        [Fact]
        public void ARefusedPairIsZeroRatherThanAbsent()
        {
            var noAntennaAtOneEnd = Model(fromRelay: 0.0, fromTransmit: 0.0, toRelay: 3.0, toTransmit: 4.0);

            Assert.NotNull(noAntennaAtOneEnd.MaxRangeMeters);
            Assert.Equal(0.0, noAntennaAtOneEnd.MaxRangeMeters);
            Assert.NotEqual(CommsReachModels.UnknownModelId, noAntennaAtOneEnd.ModelId);
        }

        /// <summary>
        /// Stock adds both nodes' <c>distanceOffset</c> to the separation before
        /// the range test, so the pair reaches that much less far in the
        /// separation a predictor measures. Charging it against the maximum here
        /// keeps this model in the consumer's units rather than stock's adjusted
        /// ones.
        /// </summary>
        [Fact]
        public void DistanceOffsetIsChargedAgainstTheMaximum()
        {
            var withoutOffset = Model(fromRelay: 100.0, fromTransmit: 0.0, toRelay: 100.0, toTransmit: 0.0);
            var withOffset = Model(
                fromRelay: 100.0, fromTransmit: 0.0, toRelay: 100.0, toTransmit: 0.0, offset: 1_000.0);

            Assert.Equal(10_000.0, withoutOffset.MaxRangeMeters);
            Assert.Equal(9_000.0, withOffset.MaxRangeMeters);
        }

        /// <summary>An offset larger than the raw reach floors at zero rather than going negative.</summary>
        [Fact]
        public void AnOffsetBiggerThanTheReachFloorsAtZero()
        {
            var model = Model(
                fromRelay: 2.0, fromTransmit: 0.0, toRelay: 2.0, toTransmit: 0.0, offset: 1_000.0);

            Assert.Equal(0.0, model.MaxRangeMeters);
        }

        /// <summary>
        /// No range model to ask means no rule to declare. Absent, because a
        /// zero would darken every prediction on the strength of a game that has
        /// not finished loading.
        /// </summary>
        [Fact]
        public void NoRangeModelDeclaresNothingRatherThanZero()
        {
            var model = CommNetReach.Model(10.0, 0.0, 10.0, 0.0, 0.0, null);

            Assert.Null(model.MaxRangeMeters);
            Assert.Equal(CommsReachModels.UnknownModelId, model.ModelId);
        }

        /// <summary>
        /// A range model that returns NaN for a pairing must not poison the
        /// maximum: the pairing simply does not count, and a pair whose every
        /// pairing is unreadable comes back as nothing reaching rather than as
        /// a NaN separation the sweep would compare against.
        /// </summary>
        [Fact]
        public void ANonFinitePairingIsSkippedRatherThanPropagated()
        {
            var model = CommNetReach.Model(
                2.0, 0.0, 3.0, 0.0, 0.0, (_, _) => double.NaN);

            Assert.Equal(0.0, model.MaxRangeMeters);
        }
    }
}
