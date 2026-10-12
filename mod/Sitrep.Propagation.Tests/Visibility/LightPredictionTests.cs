using System;
using Sitrep.Contract;
using Sitrep.Propagation.Visibility;
using Xunit;

namespace Sitrep.Propagation.Tests.Visibility
{
    public class LightPredictionTests
    {
        private const double KerbinRadius = 600_000.0;
        private const double KerbinMu = 3.5316e12;
        private const double KerbolMu = 1.1723328e18;
        private const double KerbinSma = 13_599_840_256.0;
        private const double KerbinSiderealDay = 21_549.425;

        private const int Kerbol = 0, Kerbin = 1;

        private static IPropagationProvider Propagator() => new KeplerProvider(new[]
        {
            new SystemBody(-1, null),
            new SystemBody(Kerbol, new OrbitElements(KerbinSma, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, KerbolMu)),
        });

        private static readonly OccludingBody[] KerbinHides = { new OccludingBody(Kerbin, KerbinRadius) };

        private static double PeriodAt(double radius) => 2.0 * Math.PI * Math.Sqrt(radius * radius * radius / KerbinMu);

        private static SunLineOfSightGeometry Orbiting(OrbitElements elements, IPropagationProvider provider) =>
            SunLineOfSightGeometry.ForOrbit(
                provider,
                PropagationTarget.Vessel("probe", Kerbin, elements),
                PropagationFrame.CentredOn(Kerbin),
                Kerbol,
                KerbinHides);

        [Fact]
        public void ACircularOrbitLeavesAndEntersShadowWhereTheShadowCylinderSays()
        {
            const double radius = 700_000.0;
            var provider = Propagator();

            var found = LightPrediction.Predict(
                Orbiting(new OrbitElements(radius, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, KerbinMu), provider), 0.0, surface: false);

            // Starting at periapsis along +X, the side Kerbin's shadow falls on, with the star on -X.
            Assert.False(found.Sunlit);
            Assert.Equal(LightBasis.Orbit, found.Basis);
            var halfShadow = Math.Asin(KerbinRadius / radius) / (2.0 * Math.PI);
            var period = PeriodAt(radius);
            Assert.InRange(found.NextSunriseUt!.Value, (halfShadow * period) - 2.0, (halfShadow * period) + 2.0);
            Assert.InRange(found.NextSunsetUt!.Value, ((1.0 - halfShadow) * period) - 2.0, ((1.0 - halfShadow) * period) + 2.0);
            Assert.Equal(2.0 * period, found.HorizonUt, 3);
        }

        [Fact]
        public void AnOrbitInTheTerminatorPlaneStaysLitAndHasNoInstants()
        {
            var provider = Propagator();

            var found = LightPrediction.Predict(
                Orbiting(new OrbitElements(900_000.0, 0.0, Math.PI / 2.0, Math.PI / 2.0, 0.0, 0.0, 0.0, KerbinMu), provider),
                0.0,
                surface: false);

            Assert.True(found.Sunlit);
            Assert.Null(found.NextSunriseUt);
            Assert.Null(found.NextSunsetUt);
            Assert.Equal(LightBasis.Orbit, found.Basis);
        }

        [Fact]
        public void ACraftOnTheGroundOnTheStarSideSeesItSetAndRiseAgain()
        {
            var provider = Propagator();
            // On the equator on the star's side of Kerbin at the reference time.
            var station = new RotatingGroundStation(new Vector3d(-1.0, 0.0, 0.0), 0.0, KerbinSiderealDay, KerbinRadius, 0.0);
            var geometry = SunLineOfSightGeometry.ForSurface(provider, station, PropagationFrame.CentredOn(Kerbin), Kerbol, KerbinHides);

            var found = LightPrediction.Predict(geometry, 0.0, surface: true);

            Assert.True(found.Sunlit);
            Assert.Equal(LightBasis.Surface, found.Basis);
            Assert.InRange(found.NextSunsetUt!.Value, (KerbinSiderealDay / 4.0) - 30.0, (KerbinSiderealDay / 4.0) + 30.0);
            Assert.InRange(found.NextSunriseUt!.Value, (KerbinSiderealDay * 3.0 / 4.0) - 60.0, (KerbinSiderealDay * 3.0 / 4.0) + 60.0);
        }

        [Fact]
        public void AnOrbitThatRepeatsNowhereIsWithheldRatherThanGuessed()
        {
            var provider = Propagator();

            var found = LightPrediction.Predict(
                Orbiting(new OrbitElements(-2_000_000.0, 1.5, 0.0, 0.0, 0.0, 0.0, 0.0, KerbinMu), provider),
                0.0,
                surface: false);

            Assert.Equal(LightBasis.Withheld, found.Basis);
            Assert.Null(found.NextSunriseUt);
            Assert.Null(found.NextSunsetUt);
        }

        [Fact]
        public void APatchThatEndsBeforeTheNextCrossingLimitsTheSearch()
        {
            const double radius = 700_000.0;
            var provider = Propagator();

            var found = LightPrediction.Predict(
                Orbiting(new OrbitElements(radius, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, KerbinMu), provider),
                0.0,
                surface: false,
                limitUt: 100.0);

            Assert.Equal(100.0, found.HorizonUt, 9);
            Assert.Null(found.NextSunriseUt);
        }
    }
}
