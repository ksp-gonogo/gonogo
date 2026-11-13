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
    /// A switch to another craft and back, both 30 light-minutes away, as the ground is
    /// told it: what crosses to the command centre and when.
    /// </summary>
    public class ActiveVesselSwitchScenarioTests
    {
        private const string VesselA = "aaaaaaaa-0000-0000-0000-000000000000";
        private const string VesselB = "bbbbbbbb-0000-0000-0000-000000000000";
        private const double Delay = 1800.0;

        private static KspSnapshot Snap(double ut, string vessel, double onboard)
        {
            var snapshot = BlackoutRecorderTestUplink.Snapshot(ut, connected: true, delay: Delay, onboard: onboard);
            snapshot.Values["vessel"] = new Dictionary<string, object?>
            {
                ["identity"] = new Dictionary<string, object?> { ["id"] = vessel, ["name"] = vessel },
            };
            return snapshot;
        }

        [Fact]
        public async Task EveryReadingCrossesAfterItsOwnDelayWhicheverCraftWasFlownWhenItWasMade()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new BlackoutRecorderTestUplink());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, TestBudgets.Op);
                await SubscribeAsync(client, BlackoutRecorderTestUplink.OnboardTopic, TestBudgets.Op);

                const double switchToB = 3600.0;
                const double switchBackToA = 3720.0;
                const double end = switchBackToA + 2100.0;
                for (var ut = 0.0; ut <= end; ut += 30.0)
                {
                    var onB = ut >= switchToB && ut < switchBackToA;
                    var vessel = onB ? VesselB : VesselA;
                    var value = (onB ? 1_000_000.0 : 0.0) + ut;
                    TickAndWaitForOutboxes(engine, ut, Snap(ut, vessel, value), TestBudgets.Op);
                }

                // Each frame carries the instant it was delivered at, which is the tick it crossed on.
                var arrivals = (await DrainAllStreamDataAsync(client, TestBudgets.Quiet))
                    .Where(f => f.Topic == BlackoutRecorderTestUplink.OnboardTopic)
                    .Select(f => (Tick: f.Meta.DeliveredAt, ValidAt: f.Meta.ValidAt, Payload: f.Payload == null ? (double?)null : Convert.ToDouble(f.Payload)))
                    .ToList();

                // The first craft's last half hour in flight still crosses after the switch, each reading one delay after it was made.
                foreach (var made in Enumerable.Range(0, 120).Select(i => i * 30.0))
                {
                    var arrival = Assert.Single(arrivals, a => a.Payload == made);
                    Assert.Equal(made + Delay, arrival.Tick);
                }

                // The second craft's two minutes cross from 30 minutes after the first switch, four readings of it.
                var second = arrivals.Where(a => a.Payload >= 1_000_000).ToList();
                Assert.Equal(new[] { 3600.0, 3630.0, 3660.0, 3690.0 }, second.Select(a => a.ValidAt).ToArray());
                Assert.All(second, a => Assert.Equal(a.ValidAt + Delay, a.Tick));

                // The first craft's readings from the switch back cross 32 minutes after the first switch.
                var resumed = arrivals.First(a => a.Payload == switchBackToA);
                Assert.Equal(switchBackToA + Delay, resumed.Tick);

                // A withdrawal for the craft left behind is made at the instant of a switch and at no other. Whether one survives the outbox, which keeps only the newest frame of a Topic, depends on its timing against the reading delivered in the same tick.
                Assert.All(
                    arrivals.Where(a => a.Payload == null),
                    a => Assert.Contains(Math.Round(a.ValidAt), new[] { switchToB, switchBackToA }));
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public async Task TheWithdrawalForTheCraftLeftBehindReachesTheClientWhenAnOlderReadingIsDeliveredInTheSameTick()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new BlackoutRecorderTestUplink());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, TestBudgets.Op);
                await SubscribeAsync(client, BlackoutRecorderTestUplink.OnboardTopic, TestBudgets.Op);

                // An hour on the first craft, 30 light-minutes away: its readings cross 30 minutes late.
                for (var ut = 0.0; ut < 3600.0; ut += 30.0)
                {
                    TickAndWaitForOutboxes(engine, ut, Snap(ut, VesselA, ut), TestBudgets.Op);
                }
                await DrainAllStreamDataAsync(client, TestBudgets.Quiet);

                // The switch to a craft with no link and nothing to send: the withdrawal is the only frame the new craft adds,
                // and the first craft's reading made 30 minutes ago is delivered in the same tick, to a socket that is busy.
                engine.HoldLatestFrames(true);
                var unlinked = BlackoutRecorderTestUplink.Snapshot(3600.0, connected: false, delay: 0.0);
                unlinked.Values["vessel"] = new Dictionary<string, object?>
                {
                    ["identity"] = new Dictionary<string, object?> { ["id"] = VesselB, ["name"] = VesselB },
                };
                engine.TickAndWait(3600.0, unlinked, TestBudgets.Op);
                engine.HoldLatestFrames(false);

                var frames = (await DrainAllStreamDataAsync(client, TestBudgets.Quiet))
                    .Where(f => f.Topic == BlackoutRecorderTestUplink.OnboardTopic)
                    .ToList();
                Assert.Contains(frames, f => f.Payload == null);
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public async Task ACraftSwitchedToUnderAForcedBlackoutSendsNothingWhileTheDelaySourceStaysLive()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new BlackoutRecorderTestUplink());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, TestBudgets.Op);
                await SubscribeAsync(client, BlackoutRecorderTestUplink.OnboardTopic, TestBudgets.Op);

                // The shape the dev override gives the capture: the link forced down for the craft now flown, while the
                // delay source goes on reporting the delay the real network would have, 30 minutes.
                const double switchToB = 3600.0;
                const double end = switchToB + 2400.0;
                for (var ut = 0.0; ut <= end; ut += 30.0)
                {
                    var onB = ut >= switchToB;
                    var snapshot = BlackoutRecorderTestUplink.Snapshot(
                        ut,
                        connected: !onB,
                        delay: Delay,
                        onboard: (onB ? 1_000_000.0 : 0.0) + ut);
                    snapshot.Values["vessel"] = new Dictionary<string, object?>
                    {
                        ["identity"] = new Dictionary<string, object?> { ["id"] = onB ? VesselB : VesselA, ["name"] = onB ? VesselB : VesselA },
                    };
                    TickAndWaitForOutboxes(engine, ut, snapshot, TestBudgets.Op);
                }

                var readings = (await DrainAllStreamDataAsync(client, TestBudgets.Quiet))
                    .Where(f => f.Topic == BlackoutRecorderTestUplink.OnboardTopic && f.Payload != null)
                    .Select(f => Convert.ToDouble(f.Payload))
                    .ToList();

                // The first craft's readings made before the switch cross as always. Nothing the dark craft made does, however long the wait.
                Assert.Contains(readings, v => v == 3570.0);
                Assert.DoesNotContain(readings, v => v >= 1_000_000.0);
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public async Task ASwitchWhileTheBlackoutIsAlreadyForcedOnTheCraftLeftSendsNothingOfTheNewCraftEither()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new BlackoutRecorderTestUplink());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, TestBudgets.Op);
                await SubscribeAsync(client, BlackoutRecorderTestUplink.OnboardTopic, TestBudgets.Op);

                // The override is not about one craft: it was forced before the switch, so the craft left was dark too.
                const double forcedAt = 3000.0;
                const double switchToB = 3600.0;
                const double end = switchToB + 2400.0;
                for (var ut = 0.0; ut <= end; ut += 30.0)
                {
                    var onB = ut >= switchToB;
                    var snapshot = BlackoutRecorderTestUplink.Snapshot(
                        ut,
                        connected: ut < forcedAt,
                        delay: Delay,
                        onboard: (onB ? 1_000_000.0 : 0.0) + ut);
                    snapshot.Values["vessel"] = new Dictionary<string, object?>
                    {
                        ["identity"] = new Dictionary<string, object?> { ["id"] = onB ? VesselB : VesselA, ["name"] = onB ? VesselB : VesselA },
                    };
                    TickAndWaitForOutboxes(engine, ut, snapshot, TestBudgets.Op);
                }

                var readings = (await DrainAllStreamDataAsync(client, TestBudgets.Quiet))
                    .Where(f => f.Topic == BlackoutRecorderTestUplink.OnboardTopic && f.Payload != null)
                    .Select(f => Convert.ToDouble(f.Payload))
                    .ToList();

                Assert.DoesNotContain(readings, v => v >= 1_000_000.0);
            }
            finally
            {
                engine.Stop();
            }
        }
    }
}
