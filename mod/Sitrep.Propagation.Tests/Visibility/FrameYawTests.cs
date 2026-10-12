using System;
using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Propagation.Visibility;
using Xunit;

namespace Sitrep.Propagation.Tests.Visibility
{
    /// <summary>
    /// A ground station on a planet, with the game's world axes turned about the
    /// spin axis from the propagation frame by an unknown heading. The heading is
    /// read from the planet's own position about its star, known in both frames,
    /// and the station is placed from where the game says it is. The craft sits on
    /// the far side of the star from the planet and the station faces almost
    /// directly away from it, where the separation hardly changes with heading, so
    /// a heading found from separations alone is loose by many degrees.
    /// </summary>
    public class FrameYawTests
    {
        private const double SunMu = 1.32712440018e20;
        private const double EarthRadius = 6_378_137.0;
        private const double EarthSma = 1.49598023e11;
        private const double SiderealDay = 86_164.0905;
        private const double WorldTurnedFromPropagation = 90.0 * Math.PI / 180.0;
        private const int Sun = 0, Earth = 1;

        private static readonly KeplerProvider Provider = new KeplerProvider(new[]
        {
            new SystemBody(-1, null),
            new SystemBody(Sun, new OrbitElements(EarthSma, 0.0167, 0.0, 0.0, 1.8, 0.0, 0.0, SunMu)),
        });

        private static OrbitElements Craft() =>
            new OrbitElements(1.25e11, 0.2, 0.0, 0.0, 0.0, Math.PI, 0.0, SunMu);

        private static PropagationTarget CraftTarget() => PropagationTarget.Vessel("craft", Sun, Craft());

        private static Vector3d CraftFromEarth(double ut) =>
            Provider.Solve(CraftTarget(), PropagationFrame.CentredOn(Earth), ut).Position;

        private static Vector3d EarthFromSun(double ut) =>
            Provider.Solve(PropagationTarget.Body(Earth), PropagationFrame.CentredOn(Sun), ut).Position;

        /// <summary>The station's true body-centred position in the propagation frame at the reference UT, facing 167 degrees from the craft's heading.</summary>
        private static Vector3d TrueStation(double ut)
        {
            var craft = CraftFromEarth(ut);
            var heading = Math.Atan2(craft.Y, craft.X) + Math.PI - 12.4 * Math.PI / 180.0;
            var latitude = 28.6 * Math.PI / 180.0;
            return new Vector3d(
                Math.Cos(latitude) * Math.Cos(heading),
                Math.Cos(latitude) * Math.Sin(heading),
                Math.Sin(latitude)) * EarthRadius;
        }

        private static RotatingGroundStation Station(Vector3d position, double ut) =>
            new RotatingGroundStation(position, ut, SiderealDay, position.Magnitude(), 0.0);

        private static double Separation(RotatingGroundStation station, double ut) =>
            new OrbitToRemoteStationGeometry(
                CraftTarget(),
                PropagationFrame.CentredOn(Earth),
                new OccludingBody[0],
                station,
                EarthRadius,
                Provider).SeparationAt(ut);

        private static double MeasuredYaw(double ut)
        {
            var inPropagation = EarthFromSun(ut);
            var inWorld = FrameYaw.Rotate(inPropagation, -WorldTurnedFromPropagation);
            Assert.True(FrameYaw.TryMeasure(inWorld, inPropagation, out var yaw, out var refusal, out _), refusal.ToString());
            return yaw;
        }

        [Theory]
        [InlineData(0.0)]
        [InlineData(90.0)]
        [InlineData(-61.8)]
        [InlineData(77.1)]
        [InlineData(179.0)]
        [InlineData(-179.0)]
        public void OneVectorFixesTheHeadingWithNoSecondSolution(double turnDegrees)
        {
            var turn = turnDegrees * Math.PI / 180.0;
            var inPropagation = EarthFromSun(5_000.0);
            var inWorld = FrameYaw.Rotate(inPropagation, -turn);

            Assert.True(FrameYaw.TryMeasure(inWorld, inPropagation, out var yaw, out _, out _));

            var back = FrameYaw.Rotate(inWorld, yaw);
            Assert.True((back - inPropagation).Magnitude() < 1.0, "the measured turn carries the world vector onto the propagation one");
        }

        [Fact]
        public void AStationPlacedFromItsWorldPositionMatchesTheTrueSeparationNowAndLater()
        {
            const double ut = 1_000.0;
            var truth = TrueStation(ut);
            var stationInWorld = FrameYaw.Rotate(truth, -WorldTurnedFromPropagation);

            var placed = Station(FrameYaw.Rotate(stationInWorld, MeasuredYaw(ut)), ut);
            var real = Station(truth, ut);

            foreach (var later in new[] { ut, ut + 600.0, ut + 7_200.0, ut + 40_000.0 })
            {
                var gap = Math.Abs(Separation(placed, later) - Separation(real, later));
                Assert.True(gap < 1.0, "separation at +" + (later - ut) + " s differs by " + gap + " m");
            }
        }

        [Fact]
        public void AHeadingThirteenDegreesOffMissesTheSeparationByMoreThanTheFrameCheckAllows()
        {
            const double ut = 1_000.0;
            var truth = TrueStation(ut);
            var stationInWorld = FrameYaw.Rotate(truth, -WorldTurnedFromPropagation);
            var offByThirteen = MeasuredYaw(ut) - 12.9 * Math.PI / 180.0;

            var placed = Station(FrameYaw.Rotate(stationInWorld, offByThirteen), ut);
            var gap = Math.Abs(Separation(placed, ut) - Separation(Station(truth, ut), ut));

            Assert.True(gap > 50_000.0, "a heading 12.9 degrees off leaves " + gap + " m");
        }

        [Fact]
        public void AFrameTiltedAwayFromTheSpinAxisIsRefusedNotFitted()
        {
            var inPropagation = EarthFromSun(5_000.0);
            var tilt = 20.0 * Math.PI / 180.0;
            var inWorld = new Vector3d(
                inPropagation.X,
                inPropagation.Y * Math.Cos(tilt) - inPropagation.Z * Math.Sin(tilt),
                inPropagation.Y * Math.Sin(tilt) + inPropagation.Z * Math.Cos(tilt));

            Assert.False(FrameYaw.TryMeasure(inWorld, inPropagation, out _, out var refusal, out var mismatch));
            Assert.True(refusal == FrameYawRefusal.OffAxisMismatch || refusal == FrameYawRefusal.LengthMismatch, refusal.ToString());
            Assert.True(mismatch > 1e9, "the disagreement is reported in metres: " + mismatch);
        }

        [Fact]
        public void AReferenceAlongTheSpinAxisHasNoHeadingToRead()
        {
            var up = new Vector3d(1e6, 0.0, 1e11);

            Assert.False(FrameYaw.TryMeasure(up, up, out _, out var refusal, out _));
            Assert.Equal(FrameYawRefusal.NearAxis, refusal);
        }

        [Fact]
        public void AVectorThatIsNotARealNumberIsRefused()
        {
            var good = new Vector3d(1e11, 1e10, 1e9);
            var bad = new Vector3d(double.NaN, 0.0, 0.0);

            Assert.False(FrameYaw.TryMeasure(bad, good, out _, out var refusal, out _));
            Assert.Equal(FrameYawRefusal.NotFinite, refusal);
            Assert.False(FrameYaw.TryMeasure(good, new Vector3d(0.0, 0.0, 0.0), out _, out refusal, out _));
            Assert.Equal(FrameYawRefusal.NotFinite, refusal);
        }
    }
}
