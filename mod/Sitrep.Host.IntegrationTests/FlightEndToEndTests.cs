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
    /// End-to-end coverage for the flight-lifecycle stream over the real
    /// <see cref="ChannelEngine"/>: <see cref="FlightLifecycleSampler"/> is
    /// KSP-free, so (unlike <c>CrashEndToEndTests</c>'s hand-rolled stand-in)
    /// this registers the real producer logic, driven via a tiny
    /// KSP-independent uplink wrapper (<see cref="TestFlightUplink"/>) that
    /// exposes the same GameEvents-facing surface <c>Gonogo.KSP.FlightUplink</c>
    /// drives in production (<c>host.AddSampler</c> + <c>SignalEnd</c>).
    /// </summary>
    public class FlightEndToEndTests
    {
        private static readonly TimeSpan Timeout = TestBudgets.Op;
        private static readonly TimeSpan Quiet = TestBudgets.Quiet;

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
                // deliberately sequencing after the engine's rewind branch),
                // the resulting PublishJob is only DEQUEUED after this TickJob
                // finishes, and a Delayed channel's Emit() only BUFFERS on
                // that pass (ChannelEngine.ProcessPublish never flushes on its
                // own: only a Tick's own FlushReveal does). A follow-up tick
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
        /// The game drops the active craft's link in the same instant the craft
        /// ends: a recovered or destroyed vessel is no longer the active one, so
        /// the next tick reads no link. The end is signalled while the craft was
        /// in contact and is only drained by that next tick, so the reveal gate
        /// must judge it by the link at the moment it happened.
        /// </summary>
        [Theory]
        [InlineData(FlightEndReason.Recovered)]
        [InlineData(FlightEndReason.Crashed)]
        [InlineData(FlightEndReason.Destroyed)]
        public async Task AnEndSignalledWhileInContactReachesTheClientWhenTheLinkDropsWithTheCraft(FlightEndReason reason)
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
                engine.TickAndWait(5.0, SnapshotFor(5.0, VesselA, "Alpha"), Timeout);

                uplink.Sampler.SignalEnd(VesselA, "Alpha", reason, 5.0);
                uplink.Connected = false;
                var noVessel = new KspSnapshot { Ut = 5.02, Values = new Dictionary<string, object?>() };
                engine.TickAndWait(5.02, noVessel, Timeout);
                engine.TickAndWait(5.04, new KspSnapshot { Ut = 5.04, Values = new Dictionary<string, object?>() }, Timeout);

                var frames = await DrainAllStreamDataAsync(client, Quiet);
                var ended = frames.Single(f => f.Topic == FlightTopics.EndedTopic);
                var payload = Assert.IsType<Dictionary<string, object?>>(ended.Payload);
                Assert.Equal((double)reason, Convert.ToDouble(payload["reason"]));
                Assert.Equal(VesselA, payload["vesselId"]);
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// A craft that ends has no path left to measure, so the ledger reads no
        /// delay for it from that tick on. Its end is a fact about the craft as it
        /// was, and crosses on the delay the craft's own samples crossed on: it
        /// must not be delivered ahead of them.
        /// </summary>
        [Fact]
        public async Task AnEndRecordedAfterTheCraftIsGoneCrossesOnTheDelayTheCraftLastHad()
        {
            const double oneWay = 45.0;
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            var uplink = new TestFlightUplink(pathSource: true);
            engine.RegisterUplink(uplink);
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, FlightTopics.EndedTopic, Timeout);

                engine.TickAndWait(0.0, DelaySnapshot(0.0, oneWay, VesselA, "Alpha"), Timeout);
                engine.TickAndWait(5.0, DelaySnapshot(5.0, oneWay, VesselA, "Alpha"), Timeout);

                uplink.Sampler.SignalEnd(VesselA, "Alpha", FlightEndReason.Crashed, 5.0);
                var gone = new Dictionary<string, object?>();
                engine.TickAndWait(5.02, new KspSnapshot { Ut = 5.02, Values = gone }, Timeout);
                engine.TickAndWait(5.04, new KspSnapshot { Ut = 5.04, Values = gone }, Timeout);

                // The craft's own delay has not elapsed, so the end has not crossed.
                engine.TickAndWait(5.0 + oneWay - 5.0, new KspSnapshot { Ut = 5.0 + oneWay - 5.0, Values = gone }, Timeout);
                Assert.DoesNotContain(await DrainAllStreamDataAsync(client, Quiet), f => f.Topic == FlightTopics.EndedTopic);

                engine.TickAndWait(5.0 + oneWay + 1.0, new KspSnapshot { Ut = 5.0 + oneWay + 1.0, Values = gone }, Timeout);
                Assert.Single(await DrainAllStreamDataAsync(client, Quiet), f => f.Topic == FlightTopics.EndedTopic);
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// A game event handler publishes straight from the main thread, stamped
        /// with the instant it fired. The Courier thread can reach that job after
        /// a tick that already read the craft's link down, and the fact must
        /// still be judged by the link at the instant it fired.
        /// </summary>
        [Fact]
        public async Task AFactStampedWhileInContactIsDeliveredEvenIfProcessedAfterTheLinkWasReadDown()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            var uplink = new TestFlightUplink();
            engine.RegisterUplink(uplink);
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, FlightTopics.EndedTopic, Timeout);

                engine.TickAndWait(5.0, SnapshotFor(5.0, VesselA, "Alpha"), Timeout);
                uplink.Connected = false;
                engine.TickAndWait(5.02, new KspSnapshot { Ut = 5.02, Values = new Dictionary<string, object?>() }, Timeout);

                uplink.Ended.Publish(new FlightEnded
                {
                    FlightId = VesselA,
                    VesselId = VesselA,
                    VesselName = "Alpha",
                    Reason = FlightEndReason.Recovered,
                    Ut = 5.0,
                }, 5.0);
                engine.TickAndWait(5.04, new KspSnapshot { Ut = 5.04, Values = new Dictionary<string, object?>() }, Timeout);
                engine.TickAndWait(5.06, new KspSnapshot { Ut = 5.06, Values = new Dictionary<string, object?>() }, Timeout);

                var frames = await DrainAllStreamDataAsync(client, Quiet);
                Assert.Single(frames, f => f.Topic == FlightTopics.EndedTopic);
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// The other side of the same rule: a fact stamped after the link was read
        /// down was taken out of contact, and is held, not delivered.
        /// </summary>
        [Fact]
        public async Task AFactStampedAfterTheLinkWasReadDownIsHeld()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            var uplink = new TestFlightUplink();
            engine.RegisterUplink(uplink);
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, FlightTopics.EndedTopic, Timeout);

                engine.TickAndWait(5.0, SnapshotFor(5.0, VesselA, "Alpha"), Timeout);
                uplink.Connected = false;
                engine.TickAndWait(5.02, new KspSnapshot { Ut = 5.02, Values = new Dictionary<string, object?>() }, Timeout);

                uplink.Ended.Publish(new FlightEnded
                {
                    FlightId = VesselA,
                    VesselId = VesselA,
                    VesselName = "Alpha",
                    Reason = FlightEndReason.Crashed,
                    Ut = 6.0,
                }, 6.0);
                engine.TickAndWait(6.02, new KspSnapshot { Ut = 6.02, Values = new Dictionary<string, object?>() }, Timeout);
                engine.TickAndWait(6.04, new KspSnapshot { Ut = 6.04, Values = new Dictionary<string, object?>() }, Timeout);

                var frames = await DrainAllStreamDataAsync(client, Quiet);
                Assert.DoesNotContain(frames, f => f.Topic == FlightTopics.EndedTopic);
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// An end taken out of contact is held on the active craft's link, the
        /// one link the flight topics have, and is delivered when that link
        /// comes back with no other craft on screen.
        /// </summary>
        [Fact]
        public async Task AHeldEndIsDeliveredWhenTheLinkComesBackWithNoOtherCraftActive()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            var uplink = new TestFlightUplink();
            engine.RegisterUplink(uplink);
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, FlightTopics.EndedTopic, Timeout);
                await HoldAnEndTakenOutOfContactAsync(engine, uplink, client);

                uplink.Connected = true;
                engine.TickAndWait(7.0, new KspSnapshot { Ut = 7.0, Values = new Dictionary<string, object?>() }, Timeout);

                var frames = await DrainAllStreamDataAsync(client, Quiet);
                var ended = frames.Single(f => f.Topic == FlightTopics.EndedTopic);
                var payload = Assert.IsType<Dictionary<string, object?>>(ended.Payload);
                Assert.Equal(VesselA, payload["vesselId"]);
                Assert.Equal((double)FlightEndReason.Destroyed, Convert.ToDouble(payload["reason"]));
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// Switching to another craft while the active link is dark lets go of
        /// everything held on it, the end of the craft switched away from
        /// included, so the end is never delivered.
        /// </summary>
        [Fact]
        public async Task AHeldEndIsNeverDeliveredOnceADifferentCraftBecomesActive()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            var uplink = new TestFlightUplink();
            engine.RegisterUplink(uplink);
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, FlightTopics.EndedTopic, Timeout);
                await HoldAnEndTakenOutOfContactAsync(engine, uplink, client);

                uplink.Connected = true;
                foreach (var ut in new[] { 7.0, 7.02, 8.0 })
                {
                    engine.TickAndWait(ut, SnapshotFor(ut, VesselB, "Bravo"), Timeout);
                }

                var frames = await DrainAllStreamDataAsync(client, Quiet);
                Assert.DoesNotContain(frames, f => f.Topic == FlightTopics.EndedTopic);
            }
            finally
            {
                engine.Stop();
            }
        }

        private static async Task HoldAnEndTakenOutOfContactAsync(ChannelEngine engine, TestFlightUplink uplink, TestClient client)
        {
            engine.TickAndWait(5.0, SnapshotFor(5.0, VesselA, "Alpha"), Timeout);
            uplink.Connected = false;
            engine.TickAndWait(5.02, new KspSnapshot { Ut = 5.02, Values = new Dictionary<string, object?>() }, Timeout);

            uplink.Ended.Publish(new FlightEnded
            {
                FlightId = VesselA,
                VesselId = VesselA,
                VesselName = "Alpha",
                Reason = FlightEndReason.Destroyed,
                Ut = 6.0,
            }, 6.0);
            engine.TickAndWait(6.02, new KspSnapshot { Ut = 6.02, Values = new Dictionary<string, object?>() }, Timeout);
            engine.TickAndWait(6.04, new KspSnapshot { Ut = 6.04, Values = new Dictionary<string, object?>() }, Timeout);
            Assert.DoesNotContain(await DrainAllStreamDataAsync(client, Quiet), f => f.Topic == FlightTopics.EndedTopic);
        }

        /// <summary>
        /// The ordinary case, over the real engine: KSP boots before the
        /// browser, so the flight is already in the air by the time anything
        /// subscribes. <c>ChannelEngine.ProcessPublish</c> drops a publish for
        /// a topic nobody holds and nothing archives it, so before the
        /// re-announce this subscriber received no <c>flight.started</c> for
        /// the rest of that flight, and <c>useFlight()</c> and mission
        /// auto-record (both driven solely off it) never armed.
        /// </summary>
        [Fact]
        public async Task AFlightAlreadyUnderwayReachesAClientThatSubscribesAfterItStarted()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new TestFlightUplink());
            engine.Start();
            try
            {
                // Launch and fly for a while with NOTHING subscribed.
                foreach (var ut in new[] { 0.0, 1.0, 2.0, 3.0 })
                {
                    engine.TickAndWait(ut, SnapshotFor(ut, VesselA, "Alpha"), Timeout);
                }

                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, FlightTopics.StartedTopic, Timeout);

                engine.TickAndWait(4.0, SnapshotFor(4.0, VesselA, "Alpha"), Timeout);
                engine.TickAndWait(5.0, SnapshotFor(5.0, VesselA, "Alpha"), Timeout);

                var frames = await DrainAllStreamDataAsync(client, Quiet);
                var started = frames.Single(f => f.Topic == FlightTopics.StartedTopic);
                var payload = Assert.IsType<Dictionary<string, object?>>(started.Payload);
                Assert.Equal(VesselA, payload["vesselId"]);
                // The launch instant, not the moment the dashboard opened: a
                // client tells this apart from a revert's own restart by it.
                Assert.Equal(0.0, Convert.ToDouble(payload["ut"]));
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// Headline invariant proof for the flight-lifecycle domain,
        /// end-to-end, through the real <see cref="FlightLifecycleSampler"/>:
        /// a crash signalled but not yet revealed (still short of the reveal
        /// horizon) is erased forever by a revert that lands before that
        /// horizon: exactly <c>RevertBeforeRevealErasesAReliableOrderedDelayedEventForever</c>
        /// (commit <c>82132a08</c>) proved generically, now exercised through
        /// the actual producer. The revert's own <c>flight.ended{reverted}</c>
        /// + <c>flight.started</c> pair, generated by the same rewind tick
        /// that erases the doomed crash, must still reach the client once
        /// their horizon passes: proving this is a targeted erasure of the
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
                // comms.delay channel, mirroring RevealGateTests' own
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

        /// <summary>Snapshot carrying both the vessel identity group and the comms.delay-sourced delay -- mirrors RevealGateTests' ReliableRevertTestUplink.Snapshot.</summary>
        private static KspSnapshot DelaySnapshot(double ut, double delay, string vesselId, string name)
        {
            var snapshot = SnapshotFor(ut, vesselId, name);
            snapshot.Values["delay"] = delay;
            return snapshot;
        }

        /// <summary>
        /// The KSP-independent stand-in for <c>Gonogo.KSP.FlightUplink</c>:
        /// registers the real <see cref="FlightLifecycleSampler"/> and the
        /// same <c>comms.delay</c> authority
        /// <c>Gonogo.KSP.CommsCoreUplink</c> provides in production (needed
        /// here so the reveal gate has a nonzero delay to test against). The
        /// channel is declared TrueNow here, where production declares it
        /// Delayed: this fixture wants the authority in force on the tick that
        /// sets it, and never reads the readout.
        /// </summary>
        private sealed class TestFlightUplink : ISitrepUplink
        {
            // Mandatory health floor (test double).
            public UplinkHealth Health() => UplinkHealth.Healthy;

            private readonly bool _pathSource;

            /// <param name="pathSource">Give the engine its delay the way production does, from a source that reports no measurable path once the craft is gone, rather than a channel that goes quiet.</param>
            public TestFlightUplink(bool pathSource = false)
            {
                _pathSource = pathSource;
            }

            public FlightLifecycleSampler Sampler { get; private set; } = null!;

            /// <summary>Whether the active craft has a link, as the engine's reveal gate reads it each tick.</summary>
            public volatile bool Connected = true;

            /// <summary>The same handle the sampler publishes <c>flight.ended</c> through, for a fact a test publishes the way a game event handler does.</summary>
            public IChannelPublisher Ended { get; private set; } = null!;

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
                    { Kind = SampleKind.Continuous,
                        Topic = ChannelEngine.CommsDelayTopic,
                        Delay = DelayRole.TrueNow,
                        Delivery = Delivery.LossyLatest,
                        Emission = new EmissionPolicy(keyframeIntervalUt: 1000, quantum: EmissionQuantum.Absolute(0)),
                    },
                },
            };

            private static ChannelDeclaration EventChannel(string topic) => new ChannelDeclaration
            { Kind = SampleKind.Continuous,
                Topic = topic,
                Delay = DelayRole.Delayed,
                Delivery = Delivery.ReliableOrdered,
                Emission = new EmissionPolicy(keyframeIntervalUt: 3600, quantum: EmissionQuantum.Absolute(0)),
            };

            private static ChannelDeclaration ValueChannel(string topic) => new ChannelDeclaration
            { Kind = SampleKind.Continuous,
                Topic = topic,
                Delay = DelayRole.Delayed,
                Delivery = Delivery.LossyLatest,
                Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
            };

            public void Register(IUplinkHost host)
            {
                Ended = host.Publisher(FlightTopics.EndedTopic);
                Sampler = new FlightLifecycleSampler(
                    host.Publisher(FlightTopics.CurrentTopic),
                    host.Publisher(FlightTopics.StartedTopic),
                    Ended,
                    host.Publisher(FlightTopics.VesselChangedTopic),
                    () => host.IsAnyTopicSubscribed(FlightTopics.StartedTopic));
                host.AddSampler(Sampler);
                host.SetConnectivitySource(_ => Connected);

                if (_pathSource)
                {
                    host.SetSignalDelaySource(snapshot =>
                        new CommsDelay
                        {
                            OneWaySeconds = snapshot != null && snapshot.Values.TryGetValue("delay", out var raw) && raw != null
                                ? Convert.ToDouble(raw)
                                : (double?)null,
                            Source = CommsDelaySource.SignalDelay,
                        });
                    return;
                }

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
