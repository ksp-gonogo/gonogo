using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Sitrep.Contract;
using Sitrep.Core.Serialization;
using Sitrep.Host;
using Xunit;
using static Sitrep.Host.IntegrationTests.WsTestHarness;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// Plan 3 vantage-seam multi-client safety: the observer vantage moved from the
    /// per-connection <c>session.Connection.Id</c> to the shared
    /// <c>session.SelectedVantage</c> (default "ksc"). The Archive read cursor is
    /// keyed <c>_cursors[topic][vantage]</c>, shared and MONOTONIC, so all KSC
    /// clients now share ONE cursor per topic. This suite proves a second client
    /// subscribing AFTER a first has advanced that shared cursor still catches up
    /// correctly:
    /// <list type="number">
    /// <item>a LossyLatest state topic -&gt; the second client reads the latest value;</item>
    /// <item>a keyframe-bearing ReliableOrdered diff stream (kOS-terminal-shaped)
    /// -&gt; the second client gets the self-contained KEYFRAME + reconstructed
    /// state, never a cursor-advanced-past-the-keyframe fragment.</item>
    /// </list>
    /// Case 2 is the one at risk: if it passes, the sticky-keyframe catch-up lane
    /// handles diff-stream catch-up independent of the shared cursor.
    /// </summary>
    public class SharedVantageCatchUpTests
    {
        private static readonly TimeSpan Timeout = TimeSpan.FromSeconds(10);
        private static readonly TimeSpan Quiet = TimeSpan.FromMilliseconds(500);

        [Fact]
        public async Task LossyLatestState_SecondClientOnSharedKscVantage_CatchesUpToLatest()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            var uplink = new SharedVantageTestUplink();
            engine.RegisterUplink(uplink);
            engine.Start();
            try
            {
                await using var first = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(first, SharedVantageTestUplink.StateTopic, Timeout);

                // Two delayed state samples mature past the 4s delay; the first
                // client advances the shared "ksc" cursor by draining them.
                engine.TickAndWait(1.0, SharedVantageTestUplink.Snapshot(1.0, delay: 4.0, state: "S1"), Timeout);
                engine.TickAndWait(2.0, SharedVantageTestUplink.Snapshot(2.0, delay: 4.0, state: "S2"), Timeout);
                foreach (var ut in new[] { 5.0, 6.0, 7.0 })
                {
                    engine.TickAndWait(ut, SharedVantageTestUplink.Snapshot(ut, delay: 4.0, state: "S2"), Timeout);
                }
                var firstFrames = await DrainAllStreamDataAsync(first, Quiet);
                Assert.Contains(firstFrames, f => f.Topic == SharedVantageTestUplink.StateTopic);

                // Second client subscribes long after the shared cursor advanced;
                // a LossyLatest topic must catch it up to the LATEST value.
                await using var second = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                // Raw subscribe (not SubscribeAsync): the subscribe-triggered
                // catch-up frame arrives as StreamData, which the ack-waiting
                // SubscribeAsync would discard. Drain everything the subscribe delivers.
                await second.SendAsync(EnvelopeCodec.WriteSubscribe(new Subscribe { Topic = SharedVantageTestUplink.StateTopic }));
                var catchUp = await DrainAllStreamDataAsync(second, Quiet);

                var latest = catchUp.LastOrDefault(f => f.Topic == SharedVantageTestUplink.StateTopic);
                Assert.NotNull(latest);
                Assert.Equal("S2", latest!.Payload);
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public async Task KeyframeOrderedDiff_SecondClientOnSharedKscVantage_GetsKeyframeNotFragment()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            var uplink = new SharedVantageTestUplink();
            engine.RegisterUplink(uplink);
            engine.Start();
            try
            {
                await using var first = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(first, SharedVantageTestUplink.TermTopic, Timeout);

                // A full-repaint keyframe baseline, then two diffs on top of it.
                uplink.PublishFrame("BOOT>", fullRepaint: true, ut: 1.0);
                engine.TickAndWait(5.0, SharedVantageTestUplink.Snapshot(5.0, delay: 4.0, state: "S"), Timeout);
                uplink.PublishFrame("BOOT> RUN", fullRepaint: false, ut: 5.0);
                uplink.PublishFrame("BOOT> RUN PROG.KS", fullRepaint: false, ut: 6.0);
                foreach (var ut in new[] { 6.0, 7.0, 8.0, 9.0, 10.0 })
                {
                    engine.TickAndWait(ut, SharedVantageTestUplink.Snapshot(ut, delay: 4.0, state: "S"), Timeout);
                }
                // First client drains everything, advancing the shared "ksc" cursor
                // PAST the keyframe scene, onto the trailing diffs.
                var firstFrames = await DrainAllStreamDataAsync(first, Quiet);
                Assert.Contains(firstFrames, f => f.Topic == SharedVantageTestUplink.TermTopic);

                // Second client subscribes at UT 10, long after the shared cursor
                // advanced past the keyframe. The catch-up MUST be the sticky full
                // repaint, never a bare diff applied to no base.
                await using var second = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                // Raw subscribe (not SubscribeAsync): the sticky-keyframe catch-up
                // arrives as StreamData right after subscribe, which the ack-waiting
                // SubscribeAsync would discard. Drain everything the subscribe delivers.
                await second.SendAsync(EnvelopeCodec.WriteSubscribe(new Subscribe { Topic = SharedVantageTestUplink.TermTopic }));
                var catchUp = await DrainAllStreamDataAsync(second, Quiet);

                var keyframe = catchUp.LastOrDefault(f => f.Topic == SharedVantageTestUplink.TermTopic);
                Assert.NotNull(keyframe);
                var frame = Assert.IsType<Dictionary<string, object?>>(keyframe!.Payload);
                Assert.True(
                    (bool)frame["fullRepaint"]!,
                    "second client on the shared ksc vantage must catch up via the sticky full repaint, not a cursor-advanced diff fragment");
                Assert.Equal("BOOT>", frame["content"]);
            }
            finally
            {
                engine.Stop();
            }
        }

        private sealed class SharedVantageTestUplink : ISitrepUplink
        {
            public const string StateTopic = "sv.state";
            public const string TermTopic = "sv.term";

            private IChannelPublisher? _termPublisher;

            public UplinkHealth Health() => UplinkHealth.Healthy;

            public UplinkManifest Manifest { get; } = new UplinkManifest
            {
                Id = "shared-vantage-test",
                Version = "1.0.0",
                Channels = new List<ChannelDeclaration>
                {
                    new ChannelDeclaration
                    {
                        Topic = ChannelEngine.CommsDelayTopic,
                        Delivery = Delivery.LossyLatest,
                        Emission = new EmissionPolicy(keyframeIntervalUt: 1000, quantum: EmissionQuantum.Absolute(0)),
                        Delay = DelayRole.TrueNow,
                    },
                    new ChannelDeclaration
                    {
                        // Delayed LossyLatest state snapshot.
                        Topic = StateTopic,
                        Delay = DelayRole.Delayed,
                        Delivery = Delivery.LossyLatest,
                        Emission = new EmissionPolicy(keyframeIntervalUt: 1000, quantum: EmissionQuantum.Absolute(0)),
                    },
                    new ChannelDeclaration
                    {
                        // Delayed ReliableOrdered diff stream with a keyframe, same
                        // shape as kos.terminal.<coreId>.
                        Topic = TermTopic,
                        Delay = DelayRole.Delayed,
                        Delivery = Delivery.ReliableOrdered,
                        Emission = new EmissionPolicy(keyframeIntervalUt: 3600, quantum: EmissionQuantum.Absolute(0)),
                        IsKeyframe = value => value is Dictionary<string, object?> frame
                            && frame.TryGetValue("fullRepaint", out var fr) && fr is bool isKeyframe && isKeyframe,
                    },
                },
            };

            public void Register(IUplinkHost host)
            {
                host.AddChannelSource(ChannelEngine.CommsDelayTopic, MapDelay);
                host.AddChannelSource(StateTopic, MapState);
                _termPublisher = host.Publisher(TermTopic);
            }

            public void PublishFrame(string content, bool fullRepaint, double ut) =>
                (_termPublisher ?? throw new InvalidOperationException("Register was never called"))
                    .Publish(new Dictionary<string, object?> { ["content"] = content, ["fullRepaint"] = fullRepaint }, ut);

            private static object? MapState(KspSnapshot? snapshot) =>
                snapshot != null && snapshot.Values.TryGetValue("state", out var v) ? v : null;

            private static object? MapDelay(KspSnapshot? snapshot)
            {
                if (snapshot == null || !snapshot.Values.TryGetValue("delay", out var raw) || raw == null)
                {
                    return null;
                }

                return new CommsDelay
                {
                    OneWaySeconds = Convert.ToDouble(raw),
                    Source = CommsDelaySource.SignalDelay,
                };
            }

            public static KspSnapshot Snapshot(double ut, double delay, string state) =>
                new KspSnapshot
                {
                    Ut = ut,
                    Values = new Dictionary<string, object?> { ["delay"] = delay, ["state"] = state },
                };
        }
    }
}
