using System;
using Sitrep.Propagation.Visibility;
using Xunit;
using Sitrep.Contract;

namespace Sitrep.Propagation.Tests.Visibility
{
    public class RotatingGroundStationTests
    {
        private const double KerbinRadius = 600_000.0;
        private const double KerbinRotationPeriod = 21_549.425;
        private const double Tolerance = 1e-6;

        private static RotatingGroundStation Equatorial(double rotationPeriodSeconds = KerbinRotationPeriod)
        {
            return RotatingGroundStation.FromLatitudeLongitude(
                latitudeDeg: 0.0,
                longitudeDegAtReferenceUt: 0.0,
                referenceUt: 0.0,
                rotationPeriodSeconds: rotationPeriodSeconds,
                bodyRadiusMeters: KerbinRadius,
                altitudeMeters: 0.0);
        }

        [Fact]
        public void AnEquatorialStationStartsOnPlusXAtItsOwnRadius()
        {
            Vector3d position = Equatorial().PositionAt(0.0);

            Assert.Equal(KerbinRadius, position.X, 6);
            Assert.Equal(0.0, position.Y, 6);
            Assert.Equal(0.0, position.Z, 6);
        }

        [Fact]
        public void AQuarterRotationCarriesTheStationOntoPlusY()
        {
            Vector3d position = Equatorial().PositionAt(KerbinRotationPeriod / 4.0);

            Assert.Equal(0.0, position.X, 3);
            Assert.Equal(KerbinRadius, position.Y, 3);
        }

        [Fact]
        public void OneFullPeriodReturnsTheStationToWhereItStarted()
        {
            RotatingGroundStation station = Equatorial();

            Vector3d start = station.PositionAt(0.0);
            Vector3d later = station.PositionAt(KerbinRotationPeriod);

            Assert.Equal(start.X, later.X, 3);
            Assert.Equal(start.Y, later.Y, 3);
            Assert.Equal(start.Z, later.Z, 3);
        }

        [Fact]
        public void ANegativePeriodSpinsTheOtherWay()
        {
            // Tidally-locked and retrograde-spin bodies both reach this path, and
            // the only thing that should change is the direction of travel.
            Vector3d prograde = Equatorial(KerbinRotationPeriod).PositionAt(KerbinRotationPeriod / 4.0);
            Vector3d retrograde = Equatorial(-KerbinRotationPeriod).PositionAt(KerbinRotationPeriod / 4.0);

            Assert.Equal(KerbinRadius, prograde.Y, 3);
            Assert.Equal(-KerbinRadius, retrograde.Y, 3);
        }

        [Fact]
        public void AZeroPeriodHoldsTheStationFixedRatherThanProducingNaN()
        {
            Vector3d position = Equatorial(0.0).PositionAt(500_000.0);

            Assert.Equal(KerbinRadius, position.X, 6);
            Assert.Equal(0.0, position.Y, 6);
        }

        [Fact]
        public void APolarStationSitsOnTheSpinAxisAndNeverMoves()
        {
            RotatingGroundStation pole = RotatingGroundStation.FromLatitudeLongitude(
                latitudeDeg: 90.0,
                longitudeDegAtReferenceUt: 137.0,
                referenceUt: 0.0,
                rotationPeriodSeconds: KerbinRotationPeriod,
                bodyRadiusMeters: KerbinRadius,
                altitudeMeters: 0.0);

            Vector3d start = pole.PositionAt(0.0);
            Vector3d later = pole.PositionAt(9_000.0);

            Assert.Equal(KerbinRadius, start.Z, 3);
            Assert.Equal(start.X, later.X, 3);
            Assert.Equal(start.Y, later.Y, 3);
            Assert.Equal(start.Z, later.Z, 3);
        }

        [Fact]
        public void AltitudeAddsToTheRadiusAndLeavesTheDirectionAlone()
        {
            RotatingGroundStation station = RotatingGroundStation.FromLatitudeLongitude(
                latitudeDeg: 0.0,
                longitudeDegAtReferenceUt: 0.0,
                referenceUt: 0.0,
                rotationPeriodSeconds: KerbinRotationPeriod,
                bodyRadiusMeters: KerbinRadius,
                altitudeMeters: 2_000.0);

            Assert.Equal(602_000.0, station.DistanceFromCentreMeters, 6);
            Assert.Equal(602_000.0, station.PositionAt(0.0).X, 6);
        }

        [Fact]
        public void AnUnnormalisedNormalIsAcceptedAndScaledToTheSurface()
        {
            var station = new RotatingGroundStation(
                new Vector3d(7.0, 0.0, 0.0), 0.0, KerbinRotationPeriod, KerbinRadius, 0.0);

            Assert.Equal(KerbinRadius, station.PositionAt(0.0).X, 6);
        }

        [Fact]
        public void AZeroNormalIsRejectedRatherThanSilentlyPlacingTheStationAtTheCentre()
        {
            Assert.Throws<ArgumentOutOfRangeException>(() =>
                new RotatingGroundStation(new Vector3d(0.0, 0.0, 0.0), 0.0, KerbinRotationPeriod, KerbinRadius, 0.0));
        }

        [Fact]
        public void LatitudeAndLongitudeMapOntoTheExpectedUnitDirections()
        {
            RotatingGroundStation station = RotatingGroundStation.FromLatitudeLongitude(
                latitudeDeg: 45.0,
                longitudeDegAtReferenceUt: 90.0,
                referenceUt: 0.0,
                rotationPeriodSeconds: KerbinRotationPeriod,
                bodyRadiusMeters: 1.0,
                altitudeMeters: 0.0);

            Vector3d normal = station.NormalAt(0.0);
            double halfRootTwo = Math.Sqrt(0.5);

            Assert.Equal(0.0, normal.X, 12);
            Assert.Equal(halfRootTwo, normal.Y, 12);
            Assert.Equal(halfRootTwo, normal.Z, 12);
            Assert.Equal(1.0, normal.Magnitude(), 12);
            Assert.True(Math.Abs(normal.Magnitude() - 1.0) < Tolerance);
        }

        [Fact]
        public void AStationOnATiltedBodyTurnsAboutItsAxisAndKeepsItsAngleToIt()
        {
            var tilt = 26.1 * Math.PI / 180.0;
            var axis = new Vector3d(Math.Sin(tilt), 0.0, Math.Cos(tilt));
            var normal = new Vector3d(0.0, 1.0, 0.0);
            var station = new RotatingGroundStation(normal, 0.0, 1000.0, 1000.0, 0.0, axis);

            var quarter = station.NormalAt(250.0);
            var half = station.NormalAt(500.0);
            var full = station.NormalAt(1000.0);

            Assert.True((full - normal).Magnitude() < 1e-12);
            Assert.True(Math.Abs(Dot(quarter, axis) - Dot(normal, axis)) < 1e-12);
            Assert.True(Math.Abs(quarter.Magnitude() - 1.0) < 1e-12);
            Assert.True((half - Reflect(normal, axis)).Magnitude() < 1e-12);
        }

        [Fact]
        public void AnAxisAlongZGivesTheSamePositionsAsNoAxis()
        {
            var normal = new Vector3d(0.6, 0.3, 0.74);
            var plain = new RotatingGroundStation(normal, 5.0, 86164.0, 6.0e6, 100.0);
            var withZ = new RotatingGroundStation(normal, 5.0, 86164.0, 6.0e6, 100.0, new Vector3d(0.0, 0.0, 1.0));

            Assert.Equal(plain.PositionAt(40_000.0), withZ.PositionAt(40_000.0));
        }

        [Fact]
        public void ASpinAxisThatIsNotARealDirectionIsRefused()
        {
            Assert.Throws<ArgumentOutOfRangeException>(() =>
                new RotatingGroundStation(new Vector3d(1.0, 0.0, 0.0), 0.0, 1000.0, 1000.0, 0.0, new Vector3d(0.0, 0.0, 0.0)));
        }

        private static double Dot(Vector3d a, Vector3d b) => a.X * b.X + a.Y * b.Y + a.Z * b.Z;

        private static Vector3d Reflect(Vector3d v, Vector3d axis)
        {
            var along = axis * (2.0 * Dot(v, axis));
            return along - v;
        }
    }
}
