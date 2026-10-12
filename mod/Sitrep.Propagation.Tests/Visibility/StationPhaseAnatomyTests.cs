using System;
using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Propagation.Visibility;
using Xunit;

namespace Sitrep.Propagation.Tests.Visibility
{
    /// <summary>
    /// A craft in orbit about the star seen from a station on a planet: the
    /// station's own position on its body is a term in the separation that none
    /// of the body-about-parent magnitudes carry. These pin that a station placed
    /// at the wrong rotation phase moves the separation by tens of percent of the
    /// body's radius while every magnitude those terms report stays identical,
    /// and that the anatomy names the term that moved.
    /// </summary>
    public class StationPhaseAnatomyTests
    {
        private const double SunMu = 1.32712440018e20;
        private const double EarthMu = 3.986004418e14;
        private const double EarthRadius = 6_378_137.0;
        private const double EarthSma = 1.49598023e11;
        private const double SiderealDay = 86_164.0905;
        private const int Sun = 0, Earth = 1;

        private static IReadOnlyList<SystemBody> System() => new[]
        {
            new SystemBody(-1, null),
            new SystemBody(Sun, new OrbitElements(EarthSma, 0.0167, 0.0, 0.0, 1.8, 0.0, 0.0, SunMu)),
        };

        /// <summary>About 1.0e11 m from the star, on the far side of it from the planet.</summary>
        private static OrbitElements Craft() =>
            new OrbitElements(1.25e11, 0.2, 0.0, 0.0, 0.0, Math.PI, 0.0, SunMu);

        private static OrbitToRemoteStationGeometry Geometry(double stationLongitudeDeg) =>
            new OrbitToRemoteStationGeometry(
                PropagationTarget.Vessel("craft", Sun, Craft()),
                PropagationFrame.CentredOn(Earth),
                new OccludingBody[0],
                RotatingGroundStation.FromLatitudeLongitude(
                    28.6, stationLongitudeDeg, 0.0, SiderealDay, EarthRadius, 0.0),
                EarthRadius,
                new KeplerProvider(System()));

        [Fact]
        public void AStationAtAnotherRotationPhaseMovesTheSeparationAndOnlyTheStationTerm()
        {
            var ut = 1_000.0;

            // Half a turn apart, and a quarter turn apart: whichever pair is not
            // symmetric about the line to the craft shows the full effect.
            var largest = 0.0;
            foreach (var turn in new[] { 180.0, 90.0 })
            {
                var truth = Geometry(20.0);
                var misphased = Geometry(20.0 + turn);

                var a = truth.AnatomyAt(ut);
                var b = misphased.AnatomyAt(ut);

                Assert.Equal(a.CentreToVesselMeters, b.CentreToVesselMeters, 3);
                Assert.Equal(a.StationFromCentreMeters, b.StationFromCentreMeters, 3);

                var projection = Math.Abs(a.StationTowardVesselMeters - b.StationTowardVesselMeters);
                var residual = Math.Abs(truth.SeparationAt(ut) - misphased.SeparationAt(ut));
                Assert.InRange(residual, projection - 2_000.0, projection + 2_000.0);
                largest = Math.Max(largest, residual);
            }

            Assert.InRange(largest, 3_000_000.0, 2.0 * EarthRadius);
        }

        [Fact]
        public void TheAnatomyReassemblesTheSeparation()
        {
            var geometry = Geometry(37.0);
            var ut = 52_000.0;

            var terms = geometry.AnatomyAt(ut);
            var rebuilt = Math.Sqrt(
                terms.CentreToVesselMeters * terms.CentreToVesselMeters
                + terms.StationFromCentreMeters * terms.StationFromCentreMeters
                - 2.0 * terms.CentreToVesselMeters * terms.StationTowardVesselMeters);

            Assert.Equal(geometry.SeparationAt(ut), rebuilt, 0);
        }
    }
}
