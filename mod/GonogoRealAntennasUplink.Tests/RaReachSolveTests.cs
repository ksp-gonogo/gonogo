using System;
using Gonogo.RealAntennasUplink;
using Xunit;

namespace GonogoRealAntennasUplink.Tests
{
    /// <summary>
    /// RealAntennas' answer to the comms seam's reach question: the distance at
    /// which its link budget stops closing.
    ///
    /// <para>The solve is a rearrangement of <see cref="RaLinkBudget.LinkMarginDb"/>
    /// rather than a search, so the test that matters is that the two AGREE: a
    /// closed form that has drifted from the formula it was derived from is
    /// exactly the kind of error that produces plausible numbers forever. Every
    /// case below is checked against the forward budget rather than against a
    /// hand-computed constant, which is what makes it a pin rather than a
    /// transcription that agrees with itself.</para>
    /// </summary>
    public class RaReachSolveTests
    {
        private const double TxPowerDbm = 40.0;
        private const double TxGainDbi = 30.0;
        private const double RxGainDbi = 55.0;
        private const double FrequencyHz = 8.4e9;
        private const double NoiseTempKelvin = 200.0;
        private const double SymbolRateHz = 1.0e6;
        private const double RequiredEbN0Db = 2.5;

        private static double? MaxRange(
            double txPowerDbm = TxPowerDbm,
            double txGainDbi = TxGainDbi,
            double rxGainDbi = RxGainDbi,
            double frequencyHz = FrequencyHz,
            double noiseTempKelvin = NoiseTempKelvin,
            double symbolRateHz = SymbolRateHz,
            double requiredEbN0Db = RequiredEbN0Db) =>
            RaLinkBudget.MaxRangeMeters(
                txPowerDbm, txGainDbi, rxGainDbi, frequencyHz,
                noiseTempKelvin, symbolRateHz, requiredEbN0Db);

        private static double MarginAt(double distanceMeters)
        {
            var received = RaLinkBudget.ReceivedPowerDbm(
                TxPowerDbm, TxGainDbi, RxGainDbi, distanceMeters, FrequencyHz);
            return RaLinkBudget.LinkMarginDb(received, NoiseTempKelvin, SymbolRateHz, RequiredEbN0Db);
        }

        /// <summary>
        /// The whole claim: at the solved distance the margin is 0 dB, which is
        /// exactly where <see cref="RaLinkBudget.ClosesLink"/> stops saying yes.
        /// </summary>
        [Fact]
        public void TheSolvedRangeIsWhereTheMarginReachesZero()
        {
            var range = MaxRange();

            Assert.NotNull(range);
            Assert.Equal(0.0, MarginAt(range.Value), 6);
        }

        /// <summary>
        /// Either side of it, and in the right directions. A sign error here
        /// would report a maximum that is really a minimum, and the resulting
        /// prediction would be confidently inverted rather than obviously
        /// broken.
        /// </summary>
        [Fact]
        public void InsideTheRangeClosesAndOutsideItDoesNot()
        {
            var range = MaxRange();
            Assert.NotNull(range);

            Assert.True(RaLinkBudget.ClosesLink(MarginAt(range.Value * 0.5)));
            Assert.False(RaLinkBudget.ClosesLink(MarginAt(range.Value * 2.0)));
        }

        /// <summary>
        /// More transmit power reaches further, a colder receiver reaches
        /// further, a hungrier encoder reaches less far. Monotonicity in each
        /// term is what makes a single threshold an honest summary of the rule
        /// at all.
        /// </summary>
        [Fact]
        public void TheRangeMovesTheRightWayWithEachTerm()
        {
            var baseline = MaxRange();
            Assert.NotNull(baseline);

            Assert.True(MaxRange(txPowerDbm: TxPowerDbm + 6.0) > baseline);
            Assert.True(MaxRange(rxGainDbi: RxGainDbi + 6.0) > baseline);
            Assert.True(MaxRange(noiseTempKelvin: NoiseTempKelvin * 10.0) < baseline);
            Assert.True(MaxRange(requiredEbN0Db: RequiredEbN0Db + 6.0) < baseline);
            Assert.True(MaxRange(symbolRateHz: SymbolRateHz * 100.0) < baseline);
        }

        /// <summary>
        /// Doubling the transmit power is +3 dB, and free-space loss goes as
        /// distance squared, so +3 dB is a factor of sqrt(2) in range. Pinning
        /// the SHAPE of the curve, not just its direction: a solve that used the
        /// wrong divisor would still be monotone.
        /// </summary>
        [Fact]
        public void SixDecibelsOfExtraBudgetDoublesTheRange()
        {
            var baseline = MaxRange();
            var doubled = MaxRange(txPowerDbm: TxPowerDbm + 6.0206);

            Assert.NotNull(baseline);
            Assert.NotNull(doubled);
            Assert.Equal(2.0, doubled.Value / baseline.Value, 3);
        }

        /// <summary>
        /// Inputs that make the question meaningless answer ABSENT, not zero. A
        /// zero would assert that RA carries this pair nowhere, which is a claim
        /// about the game rather than about a failed read.
        /// </summary>
        [Theory]
        [InlineData(0.0, SymbolRateHz)]
        [InlineData(-1.0, SymbolRateHz)]
        [InlineData(FrequencyHz, 0.0)]
        [InlineData(FrequencyHz, -1.0)]
        public void AMeaninglessInputIsAbsentRatherThanZero(double frequencyHz, double symbolRateHz)
        {
            Assert.Null(MaxRange(frequencyHz: frequencyHz, symbolRateHz: symbolRateHz));
        }

        /// <summary>
        /// A budget so deep in deficit that the solve underflows still has to
        /// come back as a usable number or an honest absence, never a NaN a
        /// sweep would then compare distances against.
        /// </summary>
        [Fact]
        public void AHopelessBudgetIsStillFiniteOrAbsent()
        {
            var range = MaxRange(txPowerDbm: -400.0, txGainDbi: -400.0, rxGainDbi: -400.0);

            if (range != null)
            {
                Assert.False(double.IsNaN(range.Value));
                Assert.False(double.IsInfinity(range.Value));
                Assert.True(range.Value >= 0.0);
            }
        }
    }
}
