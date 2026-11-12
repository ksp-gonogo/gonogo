using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Sitrep.Contract;
using Sitrep.Host;
using Xunit;

using static Sitrep.Host.IntegrationTests.WsTestHarness;

using StreamData = Sitrep.Contract.StreamData<object?>;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// What a centre is sent of a dark window once the link returns depends on
    /// why the craft was dark. Out of contact, the craft recorded the window and
    /// replays it. With no electric charge it recorded nothing, so the window
    /// comes back as a gap.
    /// </summary>
    public class UnpoweredCraftRecordingTests
    {
        private static readonly TimeSpan Timeout = TestBudgets.Op;
        private static readonly TimeSpan Quiet = TestBudgets.Quiet;
        private const string Craft = "lander";

        [Fact]
        public async Task ASignalCutReplaysTheRecordedWindow()
        {
            var frames = await DarkWindowAsync(unpowered: false);

            foreach (var ut in new[] { 2.0, 3.0, 4.0 })
            {
                var frame = frames.Single(f => Value(f) == ut);
                Assert.Equal(Staleness.Recorded, frame.Meta.Staleness);
            }
        }

        [Fact]
        public async Task APowerCutReplaysNothingAndStatesTheGap()
        {
            var frames = await DarkWindowAsync(unpowered: true);

            Assert.DoesNotContain(frames, f => Value(f) is 2.0 or 3.0 or 4.0);
            var resumed = frames.Single(f => Value(f) == 5.0);
            Assert.Equal(1.0, resumed.Meta.GapSinceUt);
        }

        [Fact]
        public async Task APowerCutLandsWhatWasInFlightAndStatesTheGapOnAFastTopicAcrossASignalDelay()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new BlackoutRecorderTestUplink());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, BlackoutRecorderTestUplink.OnboardTopic, Timeout);

                for (var ut = 0.0; ut <= 10.0; ut += 1.0)
                {
                    Tick(engine, Snap(ut, connected: true, onboard: ut, delay: 5.0));
                }
                engine.SetUnpoweredCraft(new[] { "vessel:" + Craft });
                for (var ut = 11.0; ut <= 20.0; ut += 1.0)
                {
                    Tick(engine, Snap(ut, connected: false, onboard: ut, delay: 0.0));
                }
                engine.SetUnpoweredCraft(Array.Empty<string>());
                for (var ut = 21.0; ut <= 30.0; ut += 1.0)
                {
                    Tick(engine, Snap(ut, connected: true, onboard: ut, delay: 5.0));
                }

                var frames = (await DrainAllStreamDataAsync(client, Quiet))
                    .Where(f => f.Topic == BlackoutRecorderTestUplink.OnboardTopic && f.Payload != null)
                    .ToList();
                // What the craft sent before its battery ran flat was already on its way and lands.
                foreach (var ut in new[] { 6.0, 7.0, 8.0, 9.0, 10.0 })
                {
                    Assert.Contains(frames, f => Value(f) == ut);
                }
                Assert.DoesNotContain(frames, f => Value(f) > 10.0 && Value(f) < 21.0);
                var first = frames.Where(f => Value(f) >= 21.0).OrderBy(f => Value(f)).First();
                Assert.Equal(10.0, first.Meta.GapSinceUt);
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>In contact to UT 1, dark UT 2 to 4, back at UT 5; every sample on the craft's onboard topic a centre is sent.</summary>
        private static async Task<List<StreamData>> DarkWindowAsync(bool unpowered)
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new BlackoutRecorderTestUplink());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, BlackoutRecorderTestUplink.OnboardTopic, Timeout);

                Tick(engine, Snap(0.0, connected: true));
                Tick(engine, Snap(1.0, connected: true, onboard: 1.0));
                if (unpowered)
                {
                    engine.SetUnpoweredCraft(new[] { "vessel:" + Craft });
                }
                foreach (var ut in new[] { 2.0, 3.0, 4.0 })
                {
                    Tick(engine, Snap(ut, connected: false, onboard: ut));
                }
                engine.SetUnpoweredCraft(Array.Empty<string>());
                Tick(engine, Snap(5.0, connected: true, onboard: 5.0));
                Tick(engine, Snap(6.0, connected: true, onboard: 5.0));

                return (await DrainAllStreamDataAsync(client, Quiet))
                    .Where(f => f.Topic == BlackoutRecorderTestUplink.OnboardTopic && f.Payload != null)
                    .ToList();
            }
            finally
            {
                engine.Stop();
            }
        }

        private static double Value(StreamData frame) => Convert.ToDouble(frame.Payload);

        private static void Tick(ChannelEngine engine, KspSnapshot snapshot) =>
            engine.TickAndWait(snapshot.Ut, snapshot, Timeout);

        private static KspSnapshot Snap(double ut, bool connected, double? onboard = null, double delay = 0.0)
        {
            var snapshot = BlackoutRecorderTestUplink.Snapshot(ut, connected, delay: delay, onboard: onboard);
            snapshot.Values["vessel"] = new Dictionary<string, object?>
            {
                ["identity"] = new Dictionary<string, object?> { ["id"] = Craft },
            };
            return snapshot;
        }
    }
}
