using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Sitrep.Contract;
using Sitrep.Host;
using Sitrep.Host.Flight;
using Xunit;

using static Sitrep.Host.IntegrationTests.WsTestHarness;
using StreamData = Sitrep.Contract.StreamData<object?>;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// End-to-end coverage for the flight-lifecycle stream over the REAL
    /// <see cref="ChannelEngine"/> — <see cref="FlightLifecycleSampler"/> is
    /// KSP-free, so (unlike <c>CrashEndToEndTests</c>'s hand-rolled stand-in)
    /// this registers the REAL producer logic, driven via a tiny
    /// KSP-independent uplink wrapper (<see cref="TestFlightUplink"/>) that
    /// exposes the same GameEvents-facing surface <c>Gonogo.KSP.FlightUplink</c>
    /// drives in production (<c>host.AddSampler</c> + <c>SignalEnd</c>).
    /// </summary>
    public class FlightEndToEndTests
    {
        private static readonly TimeSpan Timeout = TimeSpan.FromSeconds(10);
        private static readonly TimeSpan Quiet = TimeSpan.FromMilliseconds(500);

        private const string VesselA = "aaaaaaaa-0000-0000-0000-000000000000";
        private const string VesselB = "bbbbbbbb-0000-0000-0000-000000000000";

        private static KspSnapshot SnapshotFor(double ut, string vesselId, string name = "Alpha", string situation = "FLYING") => new KspSnapshot
        {
            Ut = ut,
            Values = new Dictionary<string, object?>
            {
                ["vessel"] = new Dictionary<string, object?>
                {
                    ["identity"] = new Dictionary<string, object?>
                    {
                        ["id"] = vesselId,
                        ["name"] = name,
                        ["situation"] = situation,
                    },
                },
            },
        };

        [Fact]
        public async Task LaunchArrivesAsFlightStartedThenFlightCurrentOverTheWire()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new TestFlightUplink());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, FlightTopics.StartedTopic, Timeout);
                await SubscribeAsync(client, FlightTopics.CurrentTopic, Timeout);

                engine.TickAndWait(0.0, SnapshotFor(0.0, VesselA, "Alpha"), Timeout);
                // The sampler's Publish() calls happen FROM WITHIN this tick's
                // own sampler loop (see FlightLifecycleSampler's doc comment on
                // deliberately sequencing after the engine's rewind branch) —
                // the resulting PublishJob is only DEQUEUED after this TickJob
                // finishes, and a Delayed channel's Emit() only BUFFERS on
                // that pass (ChannelEngine.ProcessPublish never flushes on its
                // own — only a Tick's own FlushReveal does). A follow-up tick
                // is what a live GonogoAddon.FixedUpdate naturally provides on
                // the very next frame; simulated here explicitly.
                engine.TickAndWait(0.0, SnapshotFor(0.0, VesselA, "Alpha"), Timeout);

                var frames = await DrainAllStreamDataAsync(client, Quiet);
                var started = frames.Single(f => f.Topic == FlightTopics.StartedTopic);
                var current = frames.Single(f => f.Topic == FlightTopics.CurrentTopic);

                // Real WS round-trip through JSON -- no CLR type survives, so
                // the payload lands as the generic Dictionary<string,object?>
                // EnvelopeCodec always parses a stream-data object into (same
                // as CrashPayloadTests' own wire round-trip assertions).
                var startedPayload = Assert.IsType<Dictionary<string, object?>>(started.Payload);
                Assert.Equal(VesselA, startedPayload["vesselId"]);
                Assert.Equal("Alpha", startedPayload["vesselName"]);

                var currentPayload = Assert.IsType<Dictionary<string, object?>>(current.Payload);
                Assert.Equal(VesselA, currentPayload["vesselId"]);
                Assert.Equal((double)Situation.Flying, Convert.ToDouble(currentPayload["phase"]));
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public async Task CrashSignalArrivesAsFlightEndedCrashedOnTheReliableLane()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            var uplink = new TestFlightUplink();
            engine.RegisterUplink(uplink);
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, FlightTopics.EndedTopic, Timeout);

                engine.TickAndWait(0.0, SnapshotFor(0.0, VesselA, "Alpha"), Timeout);
                uplink.Sampler.SignalEnd(VesselA, "Alpha", FlightEndReason.Crashed, 5.0);
                // Drained on this tick's Sample() call (dequeues the pending
                // SignalEnd and Publish()es flight.ended); a FOLLOW-UP tick
                // flushes the reveal buffer -- see the launch test's comment
                // for why one settle tick is needed after a sampler-driven
                // publish.
                engine.TickAndWait(5.0, SnapshotFor(5.0, VesselA, "Alpha"), Timeout);
                engine.TickAndWait(5.0, SnapshotFor(5.0, VesselA, "Alpha"), Timeout);

                var frames = await DrainAllStreamDataAsync(client, Quiet);
                var ended = frames.Single(f => f.Topic == FlightTopics.EndedTopic);
                var payload = Assert.IsType<Dictionary<string, object?>>(ended.Payload);
                Assert.Equal((double)FlightEndReason.Crashed, Convert.ToDouble(payload["reason"]));
                Assert.Equal(VesselA, payload["vesselId"]);
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// HEADLINE INVARIANT proof for the flight-lifecycle domain,
        /// end-to-end, through the REAL <see cref="FlightLifecycleSampler"/>:
        /// a crash signalled but NOT YET REVEALED (still short of the reveal
        /// horizon) is erased forever by a revert that lands before that
        /// horizon — exactly <c>RevertBeforeRevealErasesAReliableOrderedDelayedEventForever</c>
        /// (commit <c>82132a08</c>) proved generically, now exercised through
        /// the actual producer. The revert's OWN <c>flight.ended{reverted}</c>
        /// + <c>flight.started</c> pair, generated by the SAME rewind tick
        /// that erases the doomed crash, must still reach the client once
        /// THEIR horizon passes — proving this is a targeted erasure of the
        /// abandoned branch, not a broken reliable lane, and proving the
        /// sampler's own revert-handling publish survives the very
        /// reveal-buffer clear it is sequenced after (see
        /// <see cref="FlightLifecycleSampler"/>'s doc comment for why that
        /// ordering is safe).
        /// </summary>
        [Fact]
        public async Task RevertErasesAnUnrevealedCrashButItsOwnRevertedAndStartedEventsSurvive()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            var uplink = new TestFlightUplink();
            engine.RegisterUplink(uplink);
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, FlightTopics.EndedTopic, Timeout);
                await SubscribeAsync(client, FlightTopics.StartedTopic, Timeout);

                // Launch with NO delay authority yet (defaults to 0) so
                // flight.started reveals immediately -- a follow-up tick
                // flushes it out of the reveal buffer (see the launch test's
                // comment for why one settle tick is needed after a
                // sampler-driven publish).
                engine.TickAndWait(0.0, SnapshotFor(0.0, VesselA, "Alpha"), Timeout);
                engine.TickAndWait(0.0, SnapshotFor(0.0, VesselA, "Alpha"), Timeout);

                // Launch consumes the first flight.started -- drain it so the
                // later assertions only see the REVERT's own started event.
                var launchFrames = await DrainAllStreamDataAsync(client, Quiet);
                Assert.Contains(launchFrames, f => f.Topic == FlightTopics.StartedTopic);
                var preRevertEpoch = launchFrames.First(f => f.Topic == FlightTopics.StartedTopic).Meta.TimelineEpoch;

                // NOW establish delay authority (4s one-way) via the
                // comms.delay TrueNow channel, mirroring RevealGateTests' own
                // setup -- established AFTER the launch already revealed, so
                // only the upcoming crash signal rides the delay window.
                engine.TickAndWait(1.0, DelaySnapshot(1.0, 4.0, VesselA, "Alpha"), Timeout);

                // Advance to UT 5, signal a crash AT UT 5 (reveal horizon =
                // 5 + 4 = 9 -- genuinely un-revealed, still buffered).
                engine.TickAndWait(5.0, DelaySnapshot(5.0, 4.0, VesselA, "Alpha"), Timeout);
                uplink.Sampler.SignalEnd(VesselA, "Alpha", FlightEndReason.Crashed, 5.0);
                engine.TickAndWait(5.1, DelaySnapshot(5.1, 4.0, VesselA, "Alpha"), Timeout);

                // Confirm un-revealed before the revert (short of the UT-9 horizon).
                foreach (var ut in new[] { 6.0, 7.0, 8.0 })
                {
                    engine.TickAndWait(ut, DelaySnapshot(ut, 4.0, VesselA, "Alpha"), Timeout);
                }
                var beforeRevert = await DrainAllStreamDataAsync(client, Quiet);
                Assert.DoesNotContain(beforeRevert, f => f.Topic == FlightTopics.EndedTopic);

                // THE REVERT: backward tick to UT 2, landing on VesselB (a
                // fresh craft) -- well before the doomed crash's UT-9 horizon.
                engine.TickAndWait(2.0, DelaySnapshot(2.0, 4.0, VesselB, "Bravo"), Timeout);

                // Resume forward, past the doomed event's original UT-9
                // horizon, without ever re-signalling it.
                foreach (var ut in new[] { 3.0, 6.0, 9.0, 12.0 })
                {
                    engine.TickAndWait(ut, DelaySnapshot(ut, 4.0, VesselB, "Bravo"), Timeout);
                }
                var afterRevert = await DrainAllStreamDataAsync(client, Quiet);

                // The doomed crash never surfaces...
                Assert.DoesNotContain(afterRevert, f =>
                    f.Topic == FlightTopics.EndedTopic
                    && Convert.ToDouble(((Dictionary<string, object?>)f.Payload!)["reason"]) == (double)FlightEndReason.Crashed);

                // ...but the revert's OWN flight.ended{reverted} (for VesselA)
                // and flight.started (for VesselB) DO reach the client, at a
                // BUMPED timeline epoch (proves revert epoch-consistency).
                var reverted = afterRevert.Single(f =>
                    f.Topic == FlightTopics.EndedTopic
                    && Convert.ToDouble(((Dictionary<string, object?>)f.Payload!)["reason"]) == (double)FlightEndReason.Reverted);
                var revertedPayload = (Dictionary<string, object?>)reverted.Payload!;
                Assert.Equal(VesselA, revertedPayload["vesselId"]);
                Assert.Equal(2.0, Convert.ToDouble(revertedPayload["ut"]));
                Assert.True(reverted.Meta.TimelineEpoch > preRevertEpoch);

                var restarted = afterRevert.Single(f =>
                    f.Topic == FlightTopics.StartedTopic
                    && (string?)((Dictionary<string, object?>)f.Payload!)["vesselId"] == VesselB);
                var restartedPayload = (Dictionary<string, object?>)restarted.Payload!;
                Assert.Equal(2.0, Convert.ToDouble(restartedPayload["ut"]));
                Assert.True(restarted.Meta.TimelineEpoch > preRevertEpoch);
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>Snapshot carrying both the vessel identity group AND the comms.delay-sourced delay -- mirrors RevealGateTests' ReliableRevertTestUplink.Snapshot.</summary>
        private static KspSnapshot DelaySnapshot(double ut, double delay, string vesselId, string name)
        {
            var snapshot = SnapshotFor(ut, vesselId, name);
            snapshot.Values["delay"] = delay;
            return snapshot;
        }

        /// <summary>
        /// The KSP-independent stand-in for <c>Gonogo.KSP.FlightUplink</c> —
        /// registers the REAL <see cref="FlightLifecycleSampler"/> and the
        /// SAME <c>comms.delay</c> TrueNow authority
        /// <c>Gonogo.KSP.CommsCoreUplink</c> provides in production (needed
        /// here so the reveal gate has a nonzero delay to test against).
        /// </summary>
        private sealed class TestFlightUplink : ISitrepUplink
        {
            public FlightLifecycleSampler Sampler { get; private set; } = null!;

            public UplinkManifest Manifest { get; } = new UplinkManifest
            {
                Id = "test-flight",
                Version = "1.0.0",
                Channels = new List<ChannelDeclaration>
                {
                    ValueChannel(FlightTopics.CurrentTopic),
                    EventChannel(FlightTopics.StartedTopic),
                    EventChannel(FlightTopics.EndedTopic),
                    EventChannel(FlightTopics.VesselChangedTopic),
                    new ChannelDeclaration
                    {
                        Topic = ChannelEngine.CommsDelayTopic,
                        Delay = DelayRole.TrueNow,
                        Delivery = Delivery.LossyLatest,
                        Emission = new EmissionPolicy(keyframeIntervalUt: 1000, quantum: EmissionQuantum.Absolute(0)),
                    },
                },
            };

            private static ChannelDeclaration EventChannel(string topic) => new ChannelDeclaration
            {
                Topic = topic,
                Delay = DelayRole.Delayed,
                Delivery = Delivery.ReliableOrdered,
                Emission = new EmissionPolicy(keyframeIntervalUt: 3600, quantum: EmissionQuantum.Absolute(0)),
            };

            private static ChannelDeclaration ValueChannel(string topic) => new ChannelDeclaration
            {
                Topic = topic,
                Delay = DelayRole.Delayed,
                Delivery = Delivery.LossyLatest,
                Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
            };

            public void Register(IUplinkHost host)
            {
                Sampler = new FlightLifecycleSampler(
                    host.Publisher(FlightTopics.CurrentTopic),
                    host.Publisher(FlightTopics.StartedTopic),
                    host.Publisher(FlightTopics.EndedTopic),
                    host.Publisher(FlightTopics.VesselChangedTopic));
                host.AddSampler(Sampler);

                host.AddChannelSource(ChannelEngine.CommsDelayTopic, snapshot =>
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
                });
            }
        }
    }
}
