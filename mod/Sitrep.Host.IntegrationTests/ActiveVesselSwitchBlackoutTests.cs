using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Sitrep.Contract;
using Sitrep.Host;
using Xunit;

using static Sitrep.Host.IntegrationTests.WsTestHarness;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// What the engine recorded while one craft was dark belongs to that craft. The
    /// active-vessel node is one subject whatever craft is shown, so a switch must
    /// not read the next craft's link as the first one coming back.
    /// </summary>
    public class ActiveVesselSwitchBlackoutTests
    {
        private static readonly TimeSpan Timeout = TestBudgets.Op;
        private static readonly TimeSpan Quiet = TestBudgets.Quiet;
        private const string VesselA = "aaaaaaaa-0000-0000-0000-000000000000";
        private const string VesselB = "bbbbbbbb-0000-0000-0000-000000000000";

        private static KspSnapshot Snap(double ut, string? vessel, bool connected, double delay, double? onboard = null)
        {
            var snapshot = BlackoutRecorderTestUplink.Snapshot(ut, connected, delay, onboard);
            if (vessel != null)
            {
                snapshot.Values["vessel"] = new Dictionary<string, object?>
                {
                    ["identity"] = new Dictionary<string, object?> { ["id"] = vessel, ["name"] = vessel },
                };
            }
            return snapshot;
        }

        private static void Tick(ChannelEngine engine, KspSnapshot snapshot) =>
            engine.TickAndWait(snapshot.Ut, snapshot, Timeout);

        [Fact]
        public async Task ADarkCraftsRecordingIsNotDumpedAsTheNextCraftsHistory()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new BlackoutRecorderTestUplink());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, BlackoutRecorderTestUplink.OnboardTopic, Timeout);

                Tick(engine, Snap(0.0, VesselA, connected: true, delay: 1.0));
                Tick(engine, Snap(1.0, VesselA, connected: true, delay: 1.0, onboard: 1.0));
                foreach (var ut in new[] { 2.0, 3.0, 4.0 })
                {
                    Tick(engine, Snap(ut, VesselA, connected: false, delay: 0.0, onboard: ut));
                }
                await DrainAllStreamDataAsync(client, Quiet);

                Tick(engine, Snap(5.0, VesselB, connected: true, delay: 1.0, onboard: 50.0));
                foreach (var ut in new[] { 6.0, 7.0, 8.0 })
                {
                    Tick(engine, Snap(ut, VesselB, connected: true, delay: 1.0, onboard: 50.0));
                }

                var frames = (await DrainAllStreamDataAsync(client, Quiet))
                    .Where(f => f.Topic == BlackoutRecorderTestUplink.OnboardTopic && f.Payload != null)
                    .Select(f => Convert.ToDouble(f.Payload))
                    .ToList();
                Assert.DoesNotContain(frames, v => v is 2.0 or 3.0 or 4.0);
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public void ACraftsLastDelayInContactSurvivesTimeSpentOutsideFlight()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new BlackoutRecorderTestUplink());
            engine.Start();
            try
            {
                const string vantage = "ground:Kerbal Space Center";
                Tick(engine, Snap(1.0, VesselA, connected: true, delay: 45.0));
                Tick(engine, Snap(2.0, VesselA, connected: true, delay: 45.0));
                foreach (var ut in new[] { 3.0, 4.0, 5.0, 6.0 })
                {
                    Tick(engine, Snap(ut, null, connected: true, delay: 0.0));
                }

                Tick(engine, Snap(7.0, VesselA, connected: false, delay: 0.0));

                Assert.Equal(45.0, engine.LedgerDelayFor(vantage, ChannelEngine.NodeId));
            }
            finally
            {
                engine.Stop();
            }
        }
    }
}
