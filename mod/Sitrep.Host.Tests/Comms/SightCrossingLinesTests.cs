using System;
using System.Collections.Generic;
using System.Linq;
using Sitrep.Contract;
using Sitrep.Host.Comms;
using Sitrep.Propagation;
using Sitrep.Propagation.Contacts;
using Sitrep.Propagation.Visibility;
using Xunit;

namespace Sitrep.Host.Tests.Comms
{
    /// <summary>
    /// A craft's lines solved once for every centre that asks give each centre
    /// exactly the crossings a plan of its own stations alone gives it: the same
    /// instants, the same way round, the same delays.
    /// </summary>
    public class SightCrossingLinesTests
    {
        private const double KerbinMu = 3.5316e12;
        private const double KerbinRadius = 600_000.0;
        private const double KerbinDay = 21_549.425;
        private const double MunRadius = 200_000.0;
        private const double MunDay = 138_984.38;
        private const int Kerbin = 1;
        private const int Mun = 2;

        private static readonly SystemBody[] Bodies =
        {
            new SystemBody(-1, null),
            new SystemBody(0, new OrbitElements(13_599_840_256.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.1723328e18)),
            new SystemBody(Kerbin, new OrbitElements(12_000_000.0, 0.0, 0.0, 0.0, 0.0, 1.7, 0.0, KerbinMu)),
            new SystemBody(Kerbin, new OrbitElements(47_000_000.0, 0.0, 0.1, 1.3, 0.0, 0.9, 0.0, KerbinMu)),
        };

        private static PlanNode OnKerbin(string id, double latitude, double longitude) =>
            PlanNode.OnSurface(id, Kerbin, RotatingGroundStation.FromLatitudeLongitude(latitude, longitude, 0.0, KerbinDay, KerbinRadius, 0.0));

        /// <summary>Five stations round Kerbin and one on the Mun, which turns at another rate and so gives a plan that includes it another step.</summary>
        private static readonly PlanNode[] Stations =
        {
            OnKerbin("ground:a", 0.0, 0.0),
            OnKerbin("ground:b", 12.0, 74.0),
            OnKerbin("ground:c", -31.0, 151.0),
            OnKerbin("ground:d", 48.0, -112.0),
            OnKerbin("ground:e", -5.0, -40.0),
            PlanNode.OnSurface("ground:mun", Mun, RotatingGroundStation.FromLatitudeLongitude(3.0, 20.0, 0.0, MunDay, MunRadius, 0.0)),
        };

        private static readonly PlanGround Ground = new PlanGround(
            Stations, Bodies, Kerbin, index => index == Kerbin ? KerbinRadius : index == Mun ? MunRadius : index == 3 ? 60_000.0 : 0.0);

        private static string Describe(IReadOnlyList<LineChange>? changes) =>
            changes == null
                ? "not reckoned"
                : string.Join(" | ", changes.Select(c => c.Ut.ToString("R") + (c.Opened ? " opened " : " closed ") + c.DelaySeconds?.ToString("R")));

        [Fact]
        public void EveryCentreIsGivenTheCrossingsAPlanOfItsOwnStationsGives()
        {
            var random = new Random(1996);
            var withCrossings = 0;
            for (var round = 0; round < 60; round++)
            {
                var craft = CraftState.Orbiting(
                    "vessel:probe",
                    0.0,
                    Kerbin,
                    new OrbitElements(
                        680_000.0 + (random.NextDouble() * 2_500_000.0),
                        random.NextDouble() * 0.05,
                        random.NextDouble() * 1.4,
                        random.NextDouble() * 6.0,
                        random.NextDouble() * 6.0,
                        random.NextDouble() * 6.0,
                        0.0,
                        KerbinMu),
                    null,
                    null,
                    true,
                    new Dictionary<string, CraftLink>());
                var fromUt = random.NextDouble() * 50_000.0;
                var toUt = fromUt + 20.0 + (random.NextDouble() * 4_000.0);
                var lines = new SightCrossing.Lines(craft, Ground, fromUt, toUt);

                for (var ask = 0; ask < 12; ask++)
                {
                    // One station, as a centre that is a station asks; all of them, as the home centre does; and some in between.
                    var stations = ask % 3 == 0
                        ? new[] { Stations[random.Next(Stations.Length)] }
                        : ask % 3 == 1
                            ? Stations
                            : Stations.Where(_ => random.Next(2) == 0).DefaultIfEmpty(Stations[0]).ToArray();
                    var own = SightCrossing.Between(craft, Ground, stations, fromUt, toUt);
                    var shared = lines.Between(stations);

                    Assert.Equal(Describe(own), Describe(shared));
                    withCrossings += own != null && own.Count > 0 ? 1 : 0;
                }
            }
            Assert.True(withCrossings > 200, "only " + withCrossings + " asks had a crossing to compare");
        }

        [Fact]
        public void ACraftThatCannotBeReckonedIsNotReckonedForAnyCentre()
        {
            var unsettled = CraftState.Orbiting(
                "vessel:probe", 0.0, Kerbin, new OrbitElements(900_000.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, KerbinMu), null, null, true, new Dictionary<string, CraftLink>())
                .Unsettled();
            var lines = new SightCrossing.Lines(unsettled, Ground, 0.0, 3000.0);

            Assert.Null(lines.Between(Stations));
            Assert.Null(lines.Between(new PlanNode[0]));
        }
    }
}
