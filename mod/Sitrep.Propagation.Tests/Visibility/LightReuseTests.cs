using System;
using Sitrep.Contract;
using Sitrep.Propagation.Visibility;
using Xunit;

namespace Sitrep.Propagation.Tests.Visibility
{
    public class LightReuseTests
    {
        private const double KerbinRadius = 600_000.0;
        private const double KerbinMu = 3.5316e12;
        private const double KerbolMu = 1.1723328e18;
        private const double KerbinSma = 13_599_840_256.0;
        private const double Radius = 700_000.0;

        private const int Kerbol = 0, Kerbin = 1;

        private static readonly double MeanMotion = Math.Sqrt(KerbinMu / (Radius * Radius * Radius));
        private static readonly double Period = 2.0 * Math.PI / MeanMotion;

        private static readonly OrbitElements Coasting = new OrbitElements(Radius, 0.001, 0.1, 0.3, 0.2, 0.0, 0.0, KerbinMu);

        private static OrbitElements With(OrbitElements e, double sma = 0.0, double meanAnomaly = 0.0, double epoch = 0.0) =>
            new OrbitElements(e.Sma + sma, e.Ecc, e.Inc, e.Lan, e.ArgPe, e.MeanAnomalyAtEpoch + meanAnomaly, e.Epoch + epoch, e.Mu);

        /// <summary>The same orbit, rebuilt at a later epoch as a physics frame rebuilds it.</summary>
        private static OrbitElements Rebased(OrbitElements e, double seconds) => With(e, meanAnomaly: MeanMotion * seconds, epoch: seconds);

        /// <summary>The instants of the first shadow crossings, refined far below the resolution they are reported to.</summary>
        private static double[] TrueCrossings(OrbitElements elements)
        {
            var provider = new KeplerProvider(new[]
            {
                new SystemBody(-1, null),
                new SystemBody(Kerbol, new OrbitElements(KerbinSma, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, KerbolMu)),
            });
            var geometry = SunLineOfSightGeometry.ForOrbit(
                provider,
                PropagationTarget.Vessel("probe", Kerbin, elements),
                PropagationFrame.CentredOn(Kerbin),
                Kerbol,
                new[] { new OccludingBody(Kerbin, KerbinRadius) });
            var sweep = VisibilitySweep.Run(geometry, 0.0, LightPrediction.SearchWindowCycles * Period, Period / LightPrediction.StepsPerCycle, 1e-7);
            Assert.True(sweep.Changes.Count >= 2);
            var crossings = new double[sweep.Changes.Count];
            for (var i = 0; i < crossings.Length; i++)
            {
                crossings[i] = sweep.Changes[i].Ut;
            }
            return crossings;
        }

        [Fact]
        public void TheSameOrbitRebuiltAtALaterEpochWithRoundingNoiseIsReused()
        {
            var rebuilt = With(Rebased(Coasting, 0.02), sma: Radius * 1e-12, meanAnomaly: 1e-12);

            Assert.True(LightReuse.SameOrbit(Coasting, rebuilt, 0.0, 2.0 * Period));
        }

        [Fact]
        public void AnOrbitTheReuseAcceptsMovesEverySunriseAndSunsetByLessThanTheirResolution()
        {
            // Along the track by 0.45 of the distance flown in the resolution: just inside the allowance.
            var nudged = With(Coasting, meanAnomaly: 0.45 * LightPrediction.ResolutionSeconds * MeanMotion);
            Assert.True(LightReuse.SameOrbit(Coasting, nudged, 0.0, 2.0 * Period));

            var kept = TrueCrossings(Coasting);
            var now = TrueCrossings(nudged);
            Assert.Equal(kept.Length, now.Length);
            for (var i = 0; i < kept.Length; i++)
            {
                Assert.True(Math.Abs(kept[i] - now[i]) < LightPrediction.ResolutionSeconds, $"crossing {i} moved {Math.Abs(kept[i] - now[i])} s");
            }
        }

        [Fact]
        public void AnOrbitThatMovesTheCraftFurtherThanTheAllowanceIsSweptAgain()
        {
            var nudged = With(Coasting, meanAnomaly: 0.6 * LightPrediction.ResolutionSeconds * MeanMotion);

            Assert.False(LightReuse.SameOrbit(Coasting, nudged, 0.0, 2.0 * Period));
        }

        [Fact]
        public void AOneMetreASecondBurnIsANewOrbit()
        {
            // A prograde burn of dv at speed v raises the semi-major axis by about 2 a dv / v.
            var burned = With(Coasting, sma: 2.0 * Radius * 1.0 / (MeanMotion * Radius));

            Assert.False(LightReuse.SameOrbit(Coasting, burned, 0.0, 2.0 * Period));
        }

        [Fact]
        public void AnEmptyWindowOrAnUnsolvableOrbitIsNeverReused()
        {
            Assert.False(LightReuse.SameOrbit(Coasting, Coasting, 10.0, 10.0));
            var parabolic = new OrbitElements(Radius, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, KerbinMu);
            Assert.False(LightReuse.SameOrbit(Coasting, parabolic, 0.0, Period));
        }
    }
}
