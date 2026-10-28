using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Sitrep.Contract;
using Sitrep.Host;
using Xunit;
using static Sitrep.Host.IntegrationTests.WsTestHarness;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// A deployed-science station is timed by its own controller vessel's link,
    /// not by the craft being flown: two stations, one in contact and one not,
    /// with nothing in the snapshot about the active craft at all. Driven by
    /// <see cref="TestBreakingGroundUplink"/>, which mirrors the production
    /// station source over the real WS harness.
    /// </summary>
    public class DeployedStationLinkTests
    {
        private static readonly TimeSpan Timeout = TestBudgets.Op;
        private static readonly TimeSpan Quiet = TestBudgets.Quiet;

        private const string Near = "near-station";
        private const string Far = "far-station";

        private static string ReportTopic(string stationId) =>
            BreakingGroundViewProvider.StationPrefix + stationId + BreakingGroundViewProvider.StationReportSuffix;

        [Theory]
        [InlineData("deployed.station.abc-123.report", "fleet.abc-123")]
        [InlineData("deployed.station.abc-123", ChannelEngine.UnplacedLensNode)]
        public void AStationsReportRidesItsControllerVesselsNode(string topic, string expectedNode)
        {
            /*
             * The bare form is the trap: a per-vessel topic with no field after the
             * key is not routed, and must be held rather than timed on the active
             * craft's node.
             */
            var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new TestBreakingGroundUplink());
            Assert.Equal(expectedNode, engine.NodeFor(topic));
        }

        [Fact]
        public async Task EachStationIsDelayedByItsOwnControllersLightTime()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new TestBreakingGroundUplink());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, ReportTopic(Near), Timeout);
                await SubscribeAsync(client, ReportTopic(Far), Timeout);

                for (var ut = 0.0; ut <= 2.0; ut += 1.0)
                {
                    engine.TickAndWait(ut, Stations(ut, (Near, 2.0, true), (Far, 6.0, true)), Timeout);
                }

                var byNearLightTime = await DrainAllStreamDataAsync(client, Quiet);
                Assert.Contains(byNearLightTime, f => f.Topic == ReportTopic(Near));
                Assert.DoesNotContain(byNearLightTime, f => f.Topic == ReportTopic(Far));

                for (var ut = 3.0; ut <= 6.0; ut += 1.0)
                {
                    engine.TickAndWait(ut, Stations(ut, (Near, 2.0, true), (Far, 6.0, true)), Timeout);
                }

                var byFarLightTime = await DrainAllStreamDataAsync(client, Quiet);
                Assert.Contains(byFarLightTime, f => f.Topic == ReportTopic(Far));
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public async Task AStationOutOfContactFreezesWhileTheOneInContactKeepsReporting()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new TestBreakingGroundUplink());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, ReportTopic(Near), Timeout);
                await SubscribeAsync(client, ReportTopic(Far), Timeout);

                engine.TickAndWait(0.0, Stations(0.0, (Near, 0.0, true), (Far, 0.0, true)), Timeout);
                engine.TickAndWait(1.0, Stations(1.0, (Near, 0.0, true), (Far, 0.0, true)), Timeout);
                var warm = await DrainAllStreamDataAsync(client, Quiet);
                Assert.Contains(warm, f => f.Topic == ReportTopic(Near));
                Assert.Contains(warm, f => f.Topic == ReportTopic(Far));

                // Far loses its own path home while Near keeps its own.
                for (var ut = 2.0; ut <= 4.0; ut += 1.0)
                {
                    engine.TickAndWait(ut, Stations(ut, (Near, 0.0, true), (Far, 0.0, false)), Timeout);
                }

                var outage = await DrainAllStreamDataAsync(client, Quiet);
                Assert.DoesNotContain(outage, f => f.Topic == ReportTopic(Far) && f.Meta.ValidAt >= 2.0);
                Assert.Contains(outage, f => f.Topic == ReportTopic(Near) && f.Meta.ValidAt >= 2.0);

                // Far regains contact and resumes.
                engine.TickAndWait(5.0, Stations(5.0, (Near, 0.0, true), (Far, 0.0, true)), Timeout);
                engine.TickAndWait(6.0, Stations(6.0, (Near, 0.0, true), (Far, 0.0, true)), Timeout);
                var resumed = await DrainAllStreamDataAsync(client, Quiet);
                Assert.Contains(resumed, f => f.Topic == ReportTopic(Far) && f.Meta.ValidAt >= 5.0);
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// A snapshot at <paramref name="ut"/> whose deployed-science list carries one
        /// experiment per station, with the link its controller vessel reports. The
        /// completion moves with the tick: a payload that never changed would be
        /// suppressed by the change gate and prove nothing about what is withheld.
        /// </summary>
        private static KspSnapshot Stations(double ut, params (string id, double oneWay, bool connected)[] stations)
        {
            var list = new List<object?>();
            foreach (var (id, oneWay, connected) in stations)
            {
                list.Add(new Dictionary<string, object?>
                {
                    ["stationId"] = id,
                    ["stationName"] = id,
                    ["stationOneWay"] = oneWay,
                    ["stationConnected"] = connected,
                    ["partName"] = "Seismic Accelerometer",
                    ["experimentId"] = "surfaceExperimentSeismicAccelerometer",
                    ["scienceCompletedPercentage"] = 10.0 + ut,
                    ["scienceTransmittedPercentage"] = 0.0,
                    ["scienceValue"] = 5.0,
                    ["scienceLimit"] = 30.0,
                    ["storedData"] = ut,
                    ["sendPathHome"] = connected,
                    ["dataSendFailed"] = false,
                    ["deployedOnGround"] = true,
                });
            }
            return new KspSnapshot
            {
                Ut = ut,
                Values = new Dictionary<string, object?> { ["deployedScience"] = list },
            };
        }
    }
}
