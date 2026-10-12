using System;
using System.Collections.Generic;
using System.Linq;
using Sitrep.Contract;
using Sitrep.Propagation.Visibility;
using Xunit;

namespace Sitrep.Propagation.Tests.Visibility
{
    /// <summary>
    /// A craft in orbit about the star measured against a station on a planet
    /// that carries a rotation offset the predictor has to find. A separation is
    /// one number, so a single measurement leaves two offsets that reconcile, and
    /// a fit that returns the least residual picks either and reports a clean
    /// solve. These pin that every reconciling offset comes back, that the
    /// mirror one drops out once the body has turned, and that an offset
    /// measured against another frame regime reconciles nowhere near.
    /// </summary>
    public class StationLongitudeSolveTests
    {
        private const double SunMu = 1.32712440018e20;
        private const double EarthRadius = 6_378_137.0;
        private const double EarthSma = 1.49598023e11;
        private const double SiderealDay = 86_164.0905;
        private const double Tolerance = 50_000.0;
        private const double TrueOffset = 90.0;
        private const double RotationAngleAtStart = 251.3;
        private const int Sun = 0, Earth = 1;

        private static IReadOnlyList<SystemBody> System() => new[]
        {
            new SystemBody(-1, null),
            new SystemBody(Sun, new OrbitElements(EarthSma, 0.0167, 0.0, 0.0, 1.8, 0.0, 0.0, SunMu)),
        };

        private static OrbitElements Craft() =>
            new OrbitElements(1.25e11, 0.2, 0.0, 0.0, 0.0, Math.PI, 0.0, SunMu);

        /// <summary>
        /// The station as the predictor places it for a given offset: body-fixed
        /// longitude 20 degrees, the body's own rotation angle at <paramref name="ut"/>,
        /// plus the offset under test.
        /// </summary>
        private static OrbitToRemoteStationGeometry Geometry(double offsetDegrees, double ut) =>
            new OrbitToRemoteStationGeometry(
                PropagationTarget.Vessel("craft", Sun, Craft()),
                PropagationFrame.CentredOn(Earth),
                new OccludingBody[0],
                RotatingGroundStation.FromLatitudeLongitude(
                    28.6,
                    20.0 + RotationAngleAtStart + 360.0 * ut / SiderealDay + offsetDegrees,
                    ut,
                    SiderealDay,
                    EarthRadius,
                    0.0),
                EarthRadius,
                new KeplerProvider(System()));

        private static double Live(double ut) => Geometry(TrueOffset, ut).SeparationAt(ut);

        private static Func<double, double> ResidualAt(double ut) =>
            offset => Math.Abs(Live(ut) - Geometry(offset, ut).SeparationAt(ut));

        [Fact]
        public void AnOffsetOfZeroDoesNotReconcileWhenTheTrueOffsetIsNot()
        {
            var residual = ResidualAt(1_000.0)(0.0);

            Assert.True(residual > 1_000_000.0, "a 90 degree phase error is millions of metres: " + residual);
        }

        [Fact]
        public void OneMeasurementLeavesTheTrueOffsetAndItsMirror()
        {
            var candidates = StationLongitudeSolve.Candidates(ResidualAt(1_000.0), Tolerance);

            Assert.Contains(candidates, c => Math.Abs(c - TrueOffset) < 0.2);
            Assert.True(candidates.Count == 2 || candidates.Count == 1);
        }

        [Fact]
        public void TheMirrorOffsetDropsOutOnceTheBodyHasTurned()
        {
            var first = StationLongitudeSolve.Candidates(ResidualAt(1_000.0), Tolerance);
            Assert.True(first.Count >= 1);

            // Two hours on: the body has turned 83 degrees.
            var later = StationLongitudeSolve.Surviving(first, ResidualAt(1_000.0 + 7_200.0), Tolerance);

            Assert.Single(later);
            Assert.True(Math.Abs(later[0] - TrueOffset) < 0.2, "kept " + later[0]);
        }

        [Fact]
        public void ACandidateMeasuredAtOneTimeIsFoundAgainAtAnother()
        {
            var early = StationLongitudeSolve.Candidates(ResidualAt(1_000.0), Tolerance);
            var late = StationLongitudeSolve.Candidates(ResidualAt(60_000.0), Tolerance);

            Assert.Contains(early, c => Math.Abs(c - TrueOffset) < 0.2);
            Assert.Contains(late, c => Math.Abs(c - TrueOffset) < 0.2);
        }

        [Fact]
        public void NothingReconcilesWhenTheResidualIsNeverSmall()
        {
            var candidates = StationLongitudeSolve.Candidates(offset => 1e9 + offset * offset, Tolerance);

            Assert.Empty(candidates);
        }
    }
}
