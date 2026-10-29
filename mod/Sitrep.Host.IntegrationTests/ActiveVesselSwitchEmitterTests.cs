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
    /// What the emitter believes subscribers last saw must agree with what the
    /// ground was actually told, across a craft switch. A craft that was never heard
    /// from, or a clock that went back before the switch, must not leave the next
    /// craft's reading suppressed or the old craft's reading standing.
    /// </summary>
    public class ActiveVesselSwitchEmitterTests
    {
        private static readonly TimeSpan Timeout = TestBudgets.Op;
        private static readonly TimeSpan Quiet = TestBudgets.Quiet;
        private const string VesselA = "aaaaaaaa-0000-0000-0000-000000000000";
        private const string VesselB = "bbbbbbbb-0000-0000-0000-000000000000";

        private static KspSnapshot Snap(double ut, string vessel, bool connected, double delay, double? onboard = null)
        {
            var snapshot = BlackoutRecorderTestUplink.Snapshot(ut, connected, delay, onboard);
            snapshot.Values["vessel"] = new Dictionary<string, object?>
            {
                ["identity"] = new Dictionary<string, object?> { ["id"] = vessel, ["name"] = vessel },
            };
            return snapshot;
        }

        private static void Tick(ChannelEngine engine, KspSnapshot snapshot) =>
            engine.TickAndWait(snapshot.Ut, snapshot, Timeout);

        [Fact]
        public async Task ControlTheNextCraftsDifferentFirstReadingIsDelivered()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new BlackoutRecorderTestUplink());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, BlackoutRecorderTestUplink.OnboardTopic, Timeout);

                foreach (var ut in new[] { 0.0, 1.0, 2.0, 3.0 })
                {
                    Tick(engine, Snap(ut, VesselA, connected: false, delay: 0.0, onboard: 7.0));
                }
                await DrainAllStreamDataAsync(client, Quiet);

                foreach (var ut in new[] { 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0, 11.0, 12.0 })
                {
                    Tick(engine, Snap(ut, VesselB, connected: true, delay: 1.0, onboard: 8.0));
                }

                var frames = (await DrainAllStreamDataAsync(client, Quiet))
                    .Where(f => f.Topic == BlackoutRecorderTestUplink.OnboardTopic)
                    .ToList();
                Assert.Contains(frames, f => f.Payload != null);
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public async Task ACraftNeverHeardFromThenSwitchedAwayDoesNotSuppressTheNextCraftsEqualFirstReading()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new BlackoutRecorderTestUplink());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, BlackoutRecorderTestUplink.OnboardTopic, Timeout);

                foreach (var ut in new[] { 0.0, 1.0, 2.0, 3.0 })
                {
                    Tick(engine, Snap(ut, VesselA, connected: false, delay: 0.0, onboard: 7.0));
                }
                await DrainAllStreamDataAsync(client, Quiet);

                foreach (var ut in new[] { 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0, 11.0, 12.0 })
                {
                    Tick(engine, Snap(ut, VesselB, connected: true, delay: 1.0, onboard: 7.0));
                }

                var frames = (await DrainAllStreamDataAsync(client, Quiet))
                    .Where(f => f.Topic == BlackoutRecorderTestUplink.OnboardTopic)
                    .ToList();
                Assert.Contains(frames, f => f.Payload != null);
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public async Task ASwitchAfterTheClockWentBackStillWithdrawsTheCraftLeftBehind()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new BlackoutRecorderTestUplink());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, BlackoutRecorderTestUplink.OnboardTopic, Timeout);

                foreach (var ut in new[] { 0.0, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0 })
                {
                    Tick(engine, Snap(ut, VesselA, connected: true, delay: 1.0, onboard: 7.0));
                }
                var before = await DrainAllStreamDataAsync(client, Quiet);
                Assert.Contains(before, f => f.Topic == BlackoutRecorderTestUplink.OnboardTopic && f.Payload != null);

                Tick(engine, Snap(3.0, VesselB, connected: false, delay: 0.0));

                var after = (await DrainAllStreamDataAsync(client, Quiet))
                    .Where(f => f.Topic == BlackoutRecorderTestUplink.OnboardTopic)
                    .ToList();
                Assert.NotEmpty(after);
                Assert.Null(after[after.Count - 1].Payload);
            }
            finally
            {
                engine.Stop();
            }
        }
    }
}
