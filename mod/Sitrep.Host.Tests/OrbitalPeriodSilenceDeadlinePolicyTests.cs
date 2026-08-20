using System;
using Sitrep.Host.Comms;
using Sitrep.Propagation;
using Xunit;
using Sitrep.Contract;

namespace Sitrep.Host.Tests
{
    public class OrbitalPeriodSilenceDeadlinePolicyTests
    {
        private static OrbitElements CircularOrbit(double sma, double mu, double ecc = 0.0) =>
            new OrbitElements(sma, ecc, inc: 0, lan: 0, argPe: 0, meanAnomalyAtEpoch: 0, epoch: 0, mu: mu);

        private static SilenceSample Sample(OrbitElements? orbit, bool landed = false) =>
            new SilenceSample("v", connected: false, orbit: orbit, landedOrSplashed: landed);

        [Fact]
        public void NullOrbitFallsToTheCeilingWithNoOrbitBasis()
        {
            var policy = new OrbitalPeriodSilenceDeadlinePolicy(floorSec: 600, ceilingSec: 86400);

            var result = policy.Evaluate(Sample(null, landed: false));

            Assert.Equal(86400, result.DurationSec);
            Assert.Equal(SilenceDeadlineBasis.NoOrbit, result.Basis);
        }

        [Fact]
        public void MidRangeOrbitUsesOnePointFiveTimesItsOwnPeriod()
        {
            // Kerbin LKO-ish: sma ~700km, mu ~3.5316e12 (Kerbin's gravParameter).
            const double sma = 700_000.0;
            const double mu = 3.5316e12;
            var expectedPeriod = 2.0 * Math.PI * Math.Sqrt(sma * sma * sma / mu);
            var expectedDuration = 1.5 * expectedPeriod;

            var policy = new OrbitalPeriodSilenceDeadlinePolicy(floorSec: 60, ceilingSec: 86400, periodMultiplier: 1.5);
            var result = policy.Evaluate(Sample(CircularOrbit(sma, mu), landed: false));

            Assert.Equal(SilenceDeadlineBasis.OrbitalPeriod, result.Basis);
            Assert.Equal(expectedDuration, result.DurationSec, 3);
        }

        [Fact]
        public void VeryLowOrbitClampsToTheFloor()
        {
            // A tiny/fast orbit whose 1.5x period is well under the floor.
            var policy = new OrbitalPeriodSilenceDeadlinePolicy(floorSec: 600, ceilingSec: 86400, periodMultiplier: 1.5);
            var result = policy.Evaluate(Sample(CircularOrbit(sma: 10_000.0, mu: 3.5316e12), landed: false));

            Assert.Equal(SilenceDeadlineBasis.PolicyFloor, result.Basis);
            Assert.Equal(600, result.DurationSec);
        }

        [Fact]
        public void VeryHighOrbitClampsToTheCeiling()
        {
            // A huge, slow orbit whose 1.5x period blows past the ceiling.
            var policy = new OrbitalPeriodSilenceDeadlinePolicy(floorSec: 600, ceilingSec: 86400, periodMultiplier: 1.5);
            var result = policy.Evaluate(Sample(CircularOrbit(sma: 5.0e10, mu: 3.5316e12), landed: false));

            Assert.Equal(SilenceDeadlineBasis.PolicyCeiling, result.Basis);
            Assert.Equal(86400, result.DurationSec);
        }

        [Fact]
        public void HyperbolicOrbitFallsToTheCeilingRegardlessOfSma()
        {
            var policy = new OrbitalPeriodSilenceDeadlinePolicy(floorSec: 600, ceilingSec: 86400);
            var result = policy.Evaluate(Sample(CircularOrbit(sma: 700_000.0, mu: 3.5316e12, ecc: 1.2), landed: false));

            Assert.Equal(SilenceDeadlineBasis.PolicyCeiling, result.Basis);
            Assert.Equal(86400, result.DurationSec);
        }

        [Fact]
        public void LandedOrSplashedFallsToTheCeilingEvenWithAValidOrbit()
        {
            var policy = new OrbitalPeriodSilenceDeadlinePolicy(floorSec: 600, ceilingSec: 86400);
            var result = policy.Evaluate(Sample(CircularOrbit(sma: 700_000.0, mu: 3.5316e12), landed: true));

            Assert.Equal(SilenceDeadlineBasis.PolicyCeiling, result.Basis);
            Assert.Equal(86400, result.DurationSec);
        }

        [Theory]
        [InlineData(0.0, 3.5316e12)]
        [InlineData(-100.0, 3.5316e12)]
        [InlineData(700_000.0, 0.0)]
        [InlineData(700_000.0, -1.0)]
        public void DegenerateSmaOrMuFallsToTheCeilingRatherThanThrowing(double sma, double mu)
        {
            var policy = new OrbitalPeriodSilenceDeadlinePolicy(floorSec: 600, ceilingSec: 86400);
            var result = policy.Evaluate(Sample(CircularOrbit(sma, mu), landed: false));

            Assert.Equal(SilenceDeadlineBasis.PolicyCeiling, result.Basis);
            Assert.Equal(86400, result.DurationSec);
        }
    }
}
