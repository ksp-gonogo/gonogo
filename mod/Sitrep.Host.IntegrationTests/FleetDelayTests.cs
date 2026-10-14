using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Sitrep.Contract;
using Sitrep.Contract.Serialization;
using Sitrep.Core;
using Sitrep.Host;
using Xunit;
using static Sitrep.Host.IntegrationTests.WsTestHarness;
using StreamData = Sitrep.Contract.StreamData<object?>;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// Fleet-under-delay integration tests: each fleet vessel gets its
    /// own delayed telemetry topic. Driven by <see cref="FleetDelayTestUplink"/>
    /// over the real WS harness (the same shape as <see cref="RevealGateTests"/>).
    /// </summary>
    public class FleetDelayTests
    {
        private static readonly TimeSpan Timeout = TestBudgets.Op;
        private static readonly TimeSpan Quiet = TestBudgets.Quiet;

        [Theory]
        [InlineData("fleet.abc-123.orbit", "fleet.abc-123")] // per-vessel topic -> its own node
        [InlineData("fleet.abc-123.comms", "fleet.abc-123")] // any field under a vessel shares the node
        [InlineData("vessel.orbit", "system")]               // active-vessel topics stay on the single node
        [InlineData("trackingStation.catalog", "system")]    // other topics unchanged
        [InlineData("comms.delay", "system")]
        [InlineData("fleet.abc-123", "system")]              // no field segment -> not a per-vessel topic
        [InlineData("extension.abc-123.field", "fleet.abc-123")] // an Uplink's own declared namespace, same node
        [InlineData("trackingStation.vessel.abc-123.link", "fleet.abc-123")] // the tracking station's per-craft namespace, same node
        public void NodeForTopicRoutesFleetTopicsToPerVesselNodes(string topic, string expectedNode)
        {
            // Through a REGISTERED engine: every namespace except core's own
            // "fleet." earns the per-vessel node by declaring PerVesselNode, so
            // the routing is only answerable once the uplink has registered.
            // Not started: registration is all the routing question needs, and
            // Stop() would join a thread that never ran.
            var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new FleetDelayTestUplink());
            Assert.Equal(expectedNode, engine.NodeFor(topic));
        }

        /// <summary>
        /// The route the vessel-home capture walks (see
        /// <c>Gonogo.KSP.FleetChannels</c>) can now hand the ledger a
        /// multi-hop journey rather than a bare scalar: <c>SetVesselJourney</c>,
        /// called right after <c>SetVesselDelay</c> as production does, is
        /// what a real fleet capture wires. Not started, same reasoning as
        /// above: these are pure ledger writes, no WS server involved.
        /// </summary>
        [Fact]
        public void SetVesselJourneyGivesTheLedgerTheRoutesHops()
        {
            var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);

            engine.SetVesselDelay("probe", 3.5);
            engine.SetVesselJourney("probe", new Journey(new[]
            {
                new Hop(1.0, distanceMeters: 100, touchesHome: false),
                new Hop(2.5, distanceMeters: 200, touchesHome: true),
            }));

            var node = ChannelEngine.FleetNodePrefix + "probe";
            var journey = engine.LedgerJourneyFor("KSC", node);

            Assert.Equal(2, journey.Hops.Count);
            Assert.Equal(3.5, journey.TotalSeconds);
            Assert.Equal(engine.LedgerDelayFor("KSC", node), journey.TotalSeconds);
        }

        [Fact]
        public async Task FleetVesselsEmitPerVesselOrbitTopics()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new FleetDelayTestUplink());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, "trackingStation.vessel.near.orbit", Timeout);
                await SubscribeAsync(client, "trackingStation.vessel.far.orbit", Timeout);

                engine.TickAndWait(0.0, FleetFixture(0.0, ("near", 0.0), ("far", 0.0)), Timeout);
                engine.TickAndWait(1.0, FleetFixture(1.0, ("near", 0.0), ("far", 0.0)), Timeout);

                var frames = await DrainAllStreamDataAsync(client, Quiet);
                // Both vessels materialize their own fleet.<id>.orbit topic and deliver.
                Assert.Contains(frames, f => f.Topic == "trackingStation.vessel.near.orbit");
                Assert.Contains(frames, f => f.Topic == "trackingStation.vessel.far.orbit");
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public async Task FleetVesselDelayTopicEmitsAndSerializesEndToEnd()
        {
            // The per-craft link carries TrackingStationVesselLink (oneWaySeconds +
            // connected), emitted as a self-flattened dict. This proves it
            // serializes through the JsonWriter/WS boundary and arrives with its
            // values intact -- the coverage the .orbit-only tests missed, which
            // let a missing JsonWriter case (fixed by allowlisting the flattened
            // producer) reach the fold gate.
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new FleetDelayTestUplink());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, "trackingStation.vessel.probe.link", Timeout);

                // Every tick carries the same one-way delay (4.5), so whichever
                // sample LossyLatest delivers past the horizon carries it.
                for (var ut = 0.0; ut <= 5.0; ut += 1.0)
                {
                    engine.TickAndWait(ut, FleetFixture(ut, ("probe", 4.5)), Timeout);
                }

                var frames = await DrainAllStreamDataAsync(client, Quiet);
                var delayFrame = frames.FirstOrDefault(f => f.Topic == "trackingStation.vessel.probe.link");
                // Arriving at all proves TrackingStationVesselLink serialized end-to-end
                // (no NotSupportedException at the JsonWriter boundary).
                Assert.NotNull(delayFrame);
                var payload = Assert.IsType<Dictionary<string, object?>>(delayFrame!.Payload);
                Assert.Equal(4.5, payload["oneWaySeconds"]);
                Assert.Equal(true, payload["connected"]);
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public async Task EachFleetVesselIsDelayedByItsOwnLightTime()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new FleetDelayTestUplink());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, "trackingStation.vessel.near.orbit", Timeout);
                await SubscribeAsync(client, "trackingStation.vessel.far.orbit", Timeout);

                // near light-time 2 s, far light-time 6 s. Emit from UT 0; the
                // capture calls SetVesselDelay per vessel, so each fleet.<id>
                // node carries its own DelayTo.
                //
                // The proof is drained in two halves, at each vessel's own
                // light-time, rather than once at the end and compared by
                // DeliveredAt. LossyLatest may coalesce a burst of samples down
                // to the latest, so a single end-of-run drain can leave both
                // vessels' surviving frames sitting on the SAME delivery UT and
                // fail an ordering assertion for a reason that is correct
                // behaviour. Presence and absence survive coalescing intact:
                // it drops superseded frames, it never invents one and never
                // empties a stream that had something to reveal.
                for (var ut = 0.0; ut <= 2.0; ut += 1.0)
                {
                    engine.TickAndWait(ut, FleetFixture(ut, ("near", 2.0), ("far", 6.0)), Timeout);
                }

                var byNearLightTime = await DrainAllStreamDataAsync(client, Quiet);
                Assert.Contains(byNearLightTime, f => f.Topic == "trackingStation.vessel.near.orbit");
                Assert.DoesNotContain(byNearLightTime, f => f.Topic == "trackingStation.vessel.far.orbit");

                for (var ut = 3.0; ut <= 6.0; ut += 1.0)
                {
                    engine.TickAndWait(ut, FleetFixture(ut, ("near", 2.0), ("far", 6.0)), Timeout);
                }

                var byFarLightTime = await DrainAllStreamDataAsync(client, Quiet);
                Assert.Contains(byFarLightTime, f => f.Topic == "trackingStation.vessel.far.orbit");
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public async Task ADeclaredPerVesselNamespaceIsDelayedByEachVesselsOwnLightTime()
        {
            // The leak this closes is silent: a per-vessel topic under a
            // namespace core does not recognise records on the single default
            // node, so a Munar base's payload arrives at the ACTIVE craft's
            // light-time. The value still turns up, just early, with someone
            // else's delay on it, which no assertion about presence can see.
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new FleetDelayTestUplink());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, FleetDelayTestUplink.ExtensionPrefix + "near.field", Timeout);
                await SubscribeAsync(client, FleetDelayTestUplink.ExtensionPrefix + "far.field", Timeout);

                var nearTopic = FleetDelayTestUplink.ExtensionPrefix + "near.field";
                var farTopic = FleetDelayTestUplink.ExtensionPrefix + "far.field";

                // Drained at each vessel's own light-time rather than once at
                // the end: see EachFleetVesselIsDelayedByItsOwnLightTime for why
                // a DeliveredAt comparison is not safe against LossyLatest
                // coalescing, and presence/absence is.
                for (var ut = 0.0; ut <= 2.0; ut += 1.0)
                {
                    engine.TickAndWait(ut, FleetFixture(ut, ("near", 2.0), ("far", 6.0)), Timeout);
                }

                var byNearLightTime = await DrainAllStreamDataAsync(client, Quiet);
                Assert.Contains(byNearLightTime, f => f.Topic == nearTopic);
                Assert.DoesNotContain(byNearLightTime, f => f.Topic == farTopic);

                for (var ut = 3.0; ut <= 6.0; ut += 1.0)
                {
                    engine.TickAndWait(ut, FleetFixture(ut, ("near", 2.0), ("far", 6.0)), Timeout);
                }

                var byFarLightTime = await DrainAllStreamDataAsync(client, Quiet);
                Assert.Contains(byFarLightTime, f => f.Topic == farTopic);
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public async Task FleetVesselsFreezeIndependentlyOnTheirOwnLink()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new FleetDelayTestUplink());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, "trackingStation.vessel.a.orbit", Timeout);
                await SubscribeAsync(client, "trackingStation.vessel.b.orbit", Timeout);

                // Both connected: both stream.
                engine.TickAndWait(0.0, ConnFixture(0.0, ("a", true), ("b", true)), Timeout);
                engine.TickAndWait(1.0, ConnFixture(1.0, ("a", true), ("b", true)), Timeout);
                var warm = await DrainAllStreamDataAsync(client, Quiet);
                Assert.Contains(warm, f => f.Topic == "trackingStation.vessel.a.orbit");
                Assert.Contains(warm, f => f.Topic == "trackingStation.vessel.b.orbit");

                // Disconnect ONLY a. b stays connected. Per-subject freeze: a's
                // in-blackout samples (validAt >= 2) are withheld; b keeps streaming.
                engine.TickAndWait(2.0, ConnFixture(2.0, ("a", false), ("b", true)), Timeout);
                engine.TickAndWait(3.0, ConnFixture(3.0, ("a", false), ("b", true)), Timeout);
                engine.TickAndWait(4.0, ConnFixture(4.0, ("a", false), ("b", true)), Timeout);
                var outage = await DrainAllStreamDataAsync(client, Quiet);
                // a: no sample captured during its blackout reaches the client.
                Assert.DoesNotContain(outage, f => f.Topic == "trackingStation.vessel.a.orbit" && f.Meta.ValidAt >= 2.0);
                // b: keeps streaming its own fresh samples (validAt >= 2 delivered).
                Assert.Contains(outage, f => f.Topic == "trackingStation.vessel.b.orbit" && f.Meta.ValidAt >= 2.0);

                // a reconnects: it resumes; b was never interrupted.
                engine.TickAndWait(5.0, ConnFixture(5.0, ("a", true), ("b", true)), Timeout);
                engine.TickAndWait(6.0, ConnFixture(6.0, ("a", true), ("b", true)), Timeout);
                var resumed = await DrainAllStreamDataAsync(client, Quiet);
                Assert.Contains(resumed, f => f.Topic == "trackingStation.vessel.a.orbit" && f.Meta.ValidAt >= 5.0);
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public async Task FleetVesselPreOutageTailDrainsThenFreezes()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new FleetDelayTestUplink());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, "trackingStation.vessel.v.orbit", Timeout);

                // v has light-time 3. Emit while CONNECTED at UT 0 and 1 (these are
                // in flight, scheduled to reveal at UT 3 and 4).
                engine.TickAndWait(0.0, TailFixture(0.0, connected: true), Timeout);
                engine.TickAndWait(1.0, TailFixture(1.0, connected: true), Timeout);
                // v DISCONNECTS at UT 2. Samples emitted during its blackout (validAt
                // >= 2) get +Inf and are withheld; the pre-outage tail (validAt 0, 1)
                // still reveals as the clock overtakes their horizon (UT 3, 4).
                for (var ut = 2.0; ut <= 6.0; ut += 1.0)
                {
                    engine.TickAndWait(ut, TailFixture(ut, connected: false), Timeout);
                }

                var frames = await DrainAllStreamDataAsync(client, Quiet);
                var v = frames.Where(f => f.Topic == "trackingStation.vessel.v.orbit").ToList();
                // The pre-outage tail drained (a connected sample, validAt < 2, revealed).
                Assert.Contains(v, f => f.Meta.ValidAt < 2.0);
                // No in-blackout sample (validAt >= 2) ever reached the client: frozen.
                Assert.DoesNotContain(v, f => f.Meta.ValidAt >= 2.0);
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// The craft is three light-seconds away and its link is seen to be back
        /// on the tick at UT 6. What it recorded while dark is sent from then, so
        /// it lands at UT 9. The edge used to be dated by the clock before that
        /// tick had moved it, at UT 5, which sent the recording a tick before
        /// the link was there to carry it.
        /// </summary>
        [Fact]
        public async Task ARecordingMadeWhileDarkIsSentFromTheTickTheLinkCameBack()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new FleetDelayTestUplink());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, "trackingStation.vessel.v.orbit", Timeout);

                engine.TickAndWait(0.0, TailFixture(0.0, connected: true), Timeout);
                engine.TickAndWait(1.0, TailFixture(1.0, connected: true), Timeout);
                for (var ut = 2.0; ut <= 5.0; ut += 1.0)
                {
                    engine.TickAndWait(ut, TailFixture(ut, connected: false), Timeout);
                }
                for (var ut = 6.0; ut <= 12.0; ut += 1.0)
                {
                    engine.TickAndWait(ut, TailFixture(ut, connected: true), Timeout);
                }

                var frames = await DrainAllStreamDataAsync(client, Quiet);
                var recorded = frames.Where(f => f.Topic == "trackingStation.vessel.v.orbit" && f.Meta.ValidAt >= 2.0 && f.Meta.ValidAt <= 5.0).ToList();
                Assert.NotEmpty(recorded);
                Assert.All(recorded, f => Assert.True(
                    f.Meta.DeliveredAt >= 9.0,
                    "a sample recorded at UT " + f.Meta.ValidAt + " was delivered at UT " + f.Meta.DeliveredAt + ", before light sent when the link came back could land"));
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// An Uplink's own per-vessel topic named like a report of a blackout,
        /// ending in <c>.state</c> or <c>.contact</c>, is that craft's
        /// telemetry: it says nothing during the outage, and arrives afterwards
        /// as the craft's recording.
        /// </summary>
        [Fact]
        public async Task AnUplinksLikeNamedPerVesselTopicIsHeldThroughTheBlackout()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new FleetDelayTestUplink());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                var uplinkState = FleetDelayTestUplink.ExtensionPrefix + "q.state";
                var uplinkContact = FleetDelayTestUplink.ExtensionPrefix + "q.contact";
                foreach (var topic in new[] { "trackingStation.vessel.q.orbit", uplinkState, uplinkContact })
                {
                    await SubscribeAsync(client, topic, Timeout);
                }

                engine.TickAndWait(0.0, ContactFixture(0.0, connected: true), Timeout);
                engine.TickAndWait(1.0, ContactFixture(1.0, connected: true), Timeout);
                await DrainAllStreamDataAsync(client, Quiet);

                // Dark from UT 2 to UT 8, twice the craft's 3-second light-time:
                // long enough for anything sent early in the outage to have crossed
                // while the craft is still dark, had it been let through.
                for (var ut = 2.0; ut <= 8.0; ut += 1.0)
                {
                    engine.TickAndWait(ut, ContactFixture(ut, connected: false), Timeout);
                }
                var duringOutage = await DrainAllStreamDataAsync(client, Quiet);

                Assert.DoesNotContain(duringOutage, f => f.Topic == uplinkState && f.Meta.ValidAt >= 2.0);
                Assert.DoesNotContain(duringOutage, f => f.Topic == uplinkContact && f.Meta.ValidAt >= 2.0);

                for (var ut = 9.0; ut <= 13.0; ut += 1.0)
                {
                    engine.TickAndWait(ut, ContactFixture(ut, connected: true), Timeout);
                }
                var afterwards = await DrainAllStreamDataAsync(client, Quiet);

                foreach (var topic in new[] { uplinkState, uplinkContact })
                {
                    var replay = afterwards.Where(f => f.Topic == topic && f.Meta.ValidAt >= 2.0 && f.Meta.ValidAt <= 8.0).ToList();
                    Assert.NotEmpty(replay);
                    Assert.All(replay, f => Assert.Equal(Staleness.Recorded, f.Meta.Staleness));
                }
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// Vessel "q" at a 3-second signal delay while connected, collapsing to 0
        /// when it drops off the network (what the live routed read returns once
        /// there is no path to measure).
        /// </summary>
        private static KspSnapshot ContactFixture(double ut, bool connected)
        {
            var snap = ConnFixture(ut, ("q", connected));
            ((Dictionary<string, object?>)((List<object?>)snap.Values["vessels"]!)[0]!)["delay"] = connected ? 3.0 : 0.0;
            return snap;
        }

        private static KspSnapshot TailFixture(double ut, bool connected)
        {
            var snap = ConnFixture(ut, ("v", connected));
            // Give v a non-zero light-time so its pre-outage samples are genuinely
            // in flight (horizon ahead of the disconnect), not delivered instantly.
            ((Dictionary<string, object?>)((List<object?>)snap.Values["vessels"]!)[0]!)["delay"] = 3.0;
            return snap;
        }

        /// <summary>
        /// The fleet twin of the active vessel's mid-outage catch-up: a fleet
        /// vessel that lost its link while nobody subscribed to anything under
        /// <c>fleet.</c> is still graded as out of contact for the first client
        /// to open it.
        ///
        /// <para>The fleet capture is subscription-gated, so with no fleet
        /// subscriber it does not run at all. The link state has to be observed
        /// anyway, or the engine never learns of the outage, places no mark, and
        /// serves the pre-outage sample as <see cref="Staleness.Fresh"/> for a
        /// craft that is out of contact.</para>
        /// </summary>
        [Fact]
        public async Task AFirstSubscriberToAFleetVesselAlreadyInBlackoutIsNotToldItIsFresh()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new FleetDelayTestUplink());
            engine.Start();
            try
            {
                // A first client archives UT 1's orbit while v is in contact,
                // then leaves, so nothing under fleet. is subscribed.
                await using (var seed = await TestClient.ConnectAsync(engine.BoundPort, Timeout))
                {
                    await SubscribeAsync(seed, "trackingStation.vessel.v.orbit", Timeout);
                    engine.TickAndWait(0.0, ConnFixture(0.0, ("v", true)), Timeout);
                    engine.TickAndWait(1.0, ConnFixture(1.0, ("v", true)), Timeout);
                    await DrainAllStreamDataAsync(seed, Quiet);
                }
                await WaitUntilNothingSubscribedUnderAsync(engine, ChannelEngine.FleetNodePrefix);

                // v is out of contact from UT 2, with nobody watching.
                engine.TickAndWait(2.0, ConnFixture(2.0, ("v", false)), Timeout);
                engine.TickAndWait(3.0, ConnFixture(3.0, ("v", false)), Timeout);

                await using var late = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await late.SendAsync(Sitrep.Contract.Serialization.EnvelopeCodec.WriteSubscribe(
                    new Subscribe { Topic = "trackingStation.vessel.v.orbit" }));
                var catchUp = (await DrainAllStreamDataAsync(late, Quiet))
                    .Where(f => f.Topic == "trackingStation.vessel.v.orbit" && f.Payload != null)
                    .ToList();

                var served = Assert.Single(catchUp);
                Assert.Equal(1.0, served.Meta.ValidAt);
                Assert.Equal(Staleness.LastBeforeBlackout, served.Meta.Staleness);
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// The other half of tracking a fleet link without a subscriber: an
        /// outage that ends while nobody is watching lifts the mark, so the next
        /// client is not told a craft back in contact is still dark.
        ///
        /// <para>The last subscriber leaving mid-outage forgets the subject's
        /// reveal-gate state, so the reacquisition that follows is not seen as
        /// an edge. The mark has to come off anyway.</para>
        /// </summary>
        [Fact]
        public async Task AFleetOutageThatEndsWithNobodyWatchingNoLongerGradesTheCatchUp()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new FleetDelayTestUplink());
            engine.Start();
            try
            {
                // Watched into the outage, then abandoned while v is still dark.
                await using (var seed = await TestClient.ConnectAsync(engine.BoundPort, Timeout))
                {
                    await SubscribeAsync(seed, "trackingStation.vessel.v.orbit", Timeout);
                    engine.TickAndWait(0.0, ConnFixture(0.0, ("v", true)), Timeout);
                    engine.TickAndWait(1.0, ConnFixture(1.0, ("v", true)), Timeout);
                    engine.TickAndWait(2.0, ConnFixture(2.0, ("v", false)), Timeout);
                    await DrainAllStreamDataAsync(seed, Quiet);
                }
                await WaitUntilNothingSubscribedUnderAsync(engine, ChannelEngine.FleetNodePrefix);

                // Back in contact from UT 3, with nobody watching.
                engine.TickAndWait(3.0, ConnFixture(3.0, ("v", true)), Timeout);
                engine.TickAndWait(4.0, ConnFixture(4.0, ("v", true)), Timeout);

                await using var late = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await late.SendAsync(Sitrep.Contract.Serialization.EnvelopeCodec.WriteSubscribe(
                    new Subscribe { Topic = "trackingStation.vessel.v.orbit" }));
                var catchUp = (await DrainAllStreamDataAsync(late, Quiet))
                    .Where(f => f.Topic == "trackingStation.vessel.v.orbit" && f.Payload != null)
                    .ToList();

                Assert.NotEmpty(catchUp);
                Assert.All(catchUp, f => Assert.Equal(Staleness.Fresh, f.Meta.Staleness));
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// Returns once no client subscribes to any topic under
        /// <paramref name="prefix"/>, so a tick enqueued afterwards runs with the
        /// subscription gate on that prefix closed.
        /// </summary>
        private static async Task WaitUntilNothingSubscribedUnderAsync(ChannelEngine engine, string prefix)
        {
            var deadline = DateTime.UtcNow + Timeout;
            while (engine.IsAnyTopicSubscribed(prefix))
            {
                if (DateTime.UtcNow > deadline)
                {
                    throw new TimeoutException($"'{prefix}' still had a subscriber after {Timeout}");
                }
                await Task.Delay(10);
            }
        }

        /// <summary>
        /// A craft destroyed while out of contact does not stay out of contact
        /// for ever, and its unsent recording does not sit in the engine for the
        /// life of the save.
        ///
        /// <para>The mark is lifted by the tick that reports the craft connected
        /// again, and a craft that no longer exists is never reported again at
        /// all. So the engine learns it is gone the only way it can: the ungated
        /// capture names every vessel every tick, and this one stopped being
        /// named.</para>
        ///
        /// <para>The held recording is dropped rather than delivered. A wreck has
        /// no transmitter, so there is no instant a dump could honestly be
        /// stamped as sent from, and handing it over later would tell the
        /// operator things that never reached them.</para>
        /// </summary>
        [Fact]
        public async Task AVesselDestroyedWhileDarkLetsGoOfItsMarkAndItsRecording()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new FleetDelayTestUplink());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, "trackingStation.vessel.lost.orbit", Timeout);
                await SubscribeAsync(client, "trackingStation.vessel.home.orbit", Timeout);

                // Both in contact. "home" exists throughout and is the control:
                // it keeps the roster non-empty after "lost" goes away, and its
                // own state must survive the sweep untouched.
                engine.TickAndWait(0.0, ConnFixture(0.0, ("lost", true), ("home", true)), Timeout);
                engine.TickAndWait(1.0, ConnFixture(1.0, ("lost", true), ("home", true)), Timeout);
                await DrainAllStreamDataAsync(client, Quiet);

                // "lost" goes dark at UT 2 and records through UT 3.
                engine.TickAndWait(2.0, ConnFixture(2.0, ("lost", false), ("home", true)), Timeout);
                engine.TickAndWait(3.0, ConnFixture(3.0, ("lost", false), ("home", true)), Timeout);
                await DrainAllStreamDataAsync(client, Quiet);
                Assert.True(engine.IsSubjectMarkedDark("fleet.lost"));
                Assert.True(engine.RecordedCountForSubject("fleet.lost") > 0);

                // Destroyed at UT 4: gone from the roster, never reported again.
                for (var ut = 4.0; ut <= 8.0; ut += 1.0)
                {
                    engine.TickAndWait(ut, ConnFixture(ut, ("home", true)), Timeout);
                }
                var after = await DrainAllStreamDataAsync(client, Quiet);

                Assert.False(engine.IsSubjectMarkedDark("fleet.lost"));
                Assert.Equal(0, engine.RecordedCountForSubject("fleet.lost"));
                Assert.False(engine.HasFreezeStateForSubject("fleet.lost"));
                // Dropped, not delivered: nothing the craft recorded while dark
                // reaches the operator.
                Assert.DoesNotContain(
                    after,
                    f => f.Topic == "trackingStation.vessel.lost.orbit" && f.Meta.ValidAt >= 2.0);
                // The surviving craft is untouched by the sweep and still streams.
                Assert.True(engine.HasFreezeStateForSubject("fleet.home"));
                Assert.Contains(after, f => f.Topic == "trackingStation.vessel.home.orbit");
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// The sweep needs a roster to compare against. A tick that names no
        /// vessel cannot be told apart from a capture that did not run, and
        /// reading it as "the fleet is empty" would drop a dark craft's recording
        /// on one skipped tick, which is the opposite of the bug being fixed.
        /// </summary>
        [Fact]
        public async Task ATickThatNamesNoVesselDoesNotReleaseADarkSubject()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new FleetDelayTestUplink());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, "trackingStation.vessel.quiet.orbit", Timeout);

                engine.TickAndWait(0.0, ConnFixture(0.0, ("quiet", true)), Timeout);
                engine.TickAndWait(1.0, ConnFixture(1.0, ("quiet", false)), Timeout);
                engine.TickAndWait(2.0, ConnFixture(2.0, ("quiet", false)), Timeout);
                await DrainAllStreamDataAsync(client, Quiet);
                var held = engine.RecordedCountForSubject("fleet.quiet");
                Assert.True(held > 0);

                // A tick whose capture produced nothing at all.
                engine.TickAndWait(3.0, ConnFixture(3.0), Timeout);
                await DrainAllStreamDataAsync(client, Quiet);

                Assert.True(engine.IsSubjectMarkedDark("fleet.quiet"));
                Assert.Equal(held, engine.RecordedCountForSubject("fleet.quiet"));
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// A craft's link state is let go when it leaves the roster, and kept
        /// while it is on it, whoever is watching.
        /// </summary>
        [Fact]
        public async Task FleetSubjectFreezeMapsAreCleanedWhenAVesselGoesAway()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new FleetDelayTestUplink());
            engine.Start();
            try
            {
                var clientA = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await using var clientB = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(clientA, "trackingStation.vessel.a.orbit", Timeout);
                await SubscribeAsync(clientB, "trackingStation.vessel.b.orbit", Timeout);

                engine.TickAndWait(0.0, ConnFixture(0.0, ("a", true), ("b", true)), Timeout);
                engine.TickAndWait(1.0, ConnFixture(1.0, ("a", true), ("b", true)), Timeout);
                await DrainAllStreamDataAsync(clientB, Quiet);
                Assert.True(engine.HasFreezeStateForSubject("fleet.a"));
                Assert.True(engine.HasFreezeStateForSubject("fleet.b"));

                await clientA.DisposeAsync();
                var deadline = DateTime.UtcNow + Timeout;
                while (engine.IsAnyTopicSubscribed("trackingStation.vessel.a.") && DateTime.UtcNow < deadline)
                {
                    await Task.Delay(20);
                }
                engine.TickAndWait(2.0, ConnFixture(2.0, ("a", true), ("b", true)), Timeout);
                Assert.True(engine.HasFreezeStateForSubject("fleet.a"));

                engine.TickAndWait(3.0, ConnFixture(3.0, ("b", true)), Timeout);
                Assert.False(engine.HasFreezeStateForSubject("fleet.a"));
                Assert.True(engine.HasFreezeStateForSubject("fleet.b"));
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// A craft gone from the roster keeps its per-vessel topics until the last
        /// of what it sent has landed, and then they go: nothing grows with every
        /// craft a session has ever seen.
        /// </summary>
        [Fact]
        public async Task AGoneCraftsTopicsAreLetGoOnceItsLastLightHasLanded()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new FleetDelayTestUplink());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, "trackingStation.vessel.b.orbit", Timeout);

                engine.TickAndWait(0.0, Fixture(0.0, ("a", 5.0, true), ("b", 1.0, true)), Timeout);
                engine.TickAndWait(1.0, Fixture(1.0, ("a", 5.0, true), ("b", 1.0, true)), Timeout);
                Assert.NotNull(engine.DeclarationOf("trackingStation.vessel.a.orbit"));

                engine.TickAndWait(2.0, Fixture(2.0, ("b", 1.0, true)), Timeout);
                engine.TickAndWait(4.0, Fixture(4.0, ("b", 1.0, true)), Timeout);
                Assert.NotNull(engine.DeclarationOf("trackingStation.vessel.a.orbit"));

                engine.TickAndWait(12.0, Fixture(12.0, ("b", 1.0, true)), Timeout);
                Assert.Null(engine.DeclarationOf("trackingStation.vessel.a.orbit"));
                Assert.NotNull(engine.DeclarationOf("trackingStation.vessel.b.orbit"));
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// A dark craft whose orbit widget is closed while another of its topics
        /// stays open is still watched, and keeps the light-time it was last
        /// heard at rather than the 0 a lost path reports.
        /// </summary>
        [Fact]
        public async Task ClosingOneOfADarkCraftsTopicsKeepsItsHeldLightTime()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new FleetDelayTestUplink());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, "trackingStation.vessel.a.orbit", Timeout);
                await SubscribeAsync(client, FleetDelayTestUplink.ExtensionPrefix + "a.field", Timeout);
                await SubscribeAsync(client, "trackingStation.vessel.b.orbit", Timeout);
                var node = ChannelEngine.FleetNodePrefix + "a";

                engine.TickAndWait(0.0, Fixture(0.0, ("a", 5.0, true), ("b", 1.0, true)), Timeout);
                engine.TickAndWait(1.0, Fixture(1.0, ("a", 0.0, false), ("b", 1.0, true)), Timeout);
                Assert.Equal(5.0, engine.LedgerDelayFor("KSC", node));

                await client.SendAsync(EnvelopeCodec.WriteUnsubscribe(new Unsubscribe { Topic = "trackingStation.vessel.a.orbit" }));
                var deadline = DateTime.UtcNow + Timeout;
                while (engine.IsAnyTopicSubscribed("trackingStation.vessel.a.") && DateTime.UtcNow < deadline)
                {
                    await Task.Delay(20);
                }
                engine.TickAndWait(2.0, Fixture(2.0, ("a", 0.0, false), ("b", 1.0, true)), Timeout);

                Assert.Equal(5.0, engine.LedgerDelayFor("KSC", node));
            }
            finally
            {
                engine.Stop();
            }
        }

        private static KspSnapshot Fixture(double ut, params (string id, double delay, bool connected)[] vessels)
        {
            var snapshot = ConnFixture(ut, System.Array.ConvertAll(vessels, v => (v.id, v.connected)));
            var roster = (List<object?>)snapshot.Values["vessels"]!;
            for (var i = 0; i < vessels.Length; i++)
            {
                ((Dictionary<string, object?>)roster[i]!)["delay"] = vessels[i].delay;
            }
            return snapshot;
        }

        /// <summary>
        /// A KspSnapshot at <paramref name="ut"/> whose <c>vessels</c> roster
        /// carries each vessel's id, a per-vessel <c>delay</c> (one-way seconds,
        /// consumed by the test uplink's SetVesselDelay), and an orbit-element
        /// dict.
        /// </summary>
        internal static KspSnapshot FleetFixture(double ut, params (string id, double delay)[] vessels)
        {
            var roster = new List<object?>();
            foreach (var (id, delay) in vessels)
            {
                roster.Add(new Dictionary<string, object?>
                {
                    ["id"] = id,
                    ["delay"] = delay,
                    ["orbit"] = new Dictionary<string, object?>
                    {
                        ["sma"] = 700000.0,
                        ["ecc"] = 0.0,
                        ["inc"] = 0.0,
                        ["meanAnomalyAtEpoch"] = 0.0,
                        // Stamped with the tick, because a craft in orbit is at
                        // a different place each time it is read. Held at a
                        // constant, the roster payload does not move and the
                        // change-gate correctly suppresses every tick after the
                        // first, so a test asserting "b keeps streaming" would
                        // be asserting against a fixture no vessel resembles.
                        ["epoch"] = ut,
                        ["mu"] = 3.5316000e12,
                        ["referenceBody"] = "Kerbin",
                    },
                });
            }
            return new KspSnapshot
            {
                Ut = ut,
                Values = new Dictionary<string, object?> { ["vessels"] = roster },
            };
        }

        /// <summary>
        /// A KspSnapshot at <paramref name="ut"/> whose vessels carry a per-vessel
        /// <c>connected</c> flag (delay 0), for per-subject freeze tests.
        /// </summary>
        internal static KspSnapshot ConnFixture(double ut, params (string id, bool connected)[] vessels)
        {
            var roster = new List<object?>();
            foreach (var (id, connected) in vessels)
            {
                roster.Add(new Dictionary<string, object?>
                {
                    ["id"] = id,
                    ["delay"] = 0.0,
                    ["connected"] = connected,
                    ["orbit"] = new Dictionary<string, object?>
                    {
                        ["sma"] = 700000.0,
                        ["ecc"] = 0.0,
                        ["inc"] = 0.0,
                        ["meanAnomalyAtEpoch"] = 0.0,
                        // Stamped with the tick, because a craft in orbit is at
                        // a different place each time it is read. Held at a
                        // constant, the roster payload does not move and the
                        // change-gate correctly suppresses every tick after the
                        // first, so a test asserting "b keeps streaming" would
                        // be asserting against a fixture no vessel resembles.
                        ["epoch"] = ut,
                        ["mu"] = 3.5316000e12,
                        ["referenceBody"] = "Kerbin",
                    },
                });
            }
            return new KspSnapshot
            {
                Ut = ut,
                Values = new Dictionary<string, object?> { ["vessels"] = roster },
            };
        }
    }

    /// <summary>
    /// Routing for a per-vessel namespace whose key is not a vessel id.
    ///
    /// <para>A namespace keyed by a device rather than by a craft cannot use
    /// the plain <c>PerVesselNode</c> reading, which takes the key to be the
    /// vessel id: it would address <c>fleet.&lt;deviceKey&gt;</c>, a node
    /// nothing ever writes a delay for. That is a quieter failure than the
    /// wrong delay it would be fixing, which is why such a namespace declares
    /// a resolver instead.</para>
    ///
    /// <para>Deliberately exercised through a test double rather than a real
    /// Uplink: the behaviour belongs to the engine, and naming a particular
    /// Uplink here would both couple this suite to it and put that Uplink's
    /// token outside its own directory.</para>
    /// </summary>
    public class KeyedNamespaceRoutingTests
    {
        [Fact]
        public void AKeyedNamespaceResolvesItsKeyToTheOwningVessel()
        {
            var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new KeyedNamespaceTestUplink(
                key => key == "7" ? "vessel-abc" : null));

            Assert.Equal(
                ChannelEngine.FleetNodePrefix + "vessel-abc",
                engine.NodeFor("keyed.7.screen"));
        }

        /// <summary>
        /// A key this pass cannot place routes to the active craft, where an
        /// unrouted topic already sits, rather than to a minted node the ledger
        /// has never heard of. Never inventing an id is the point: a node with
        /// no delay row is worse than one with the wrong delay, because nothing
        /// downstream can see that it is missing.
        /// </summary>
        [Fact]
        public void AnUnplaceableKeyFallsBackToTheActiveCraft()
        {
            var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new KeyedNamespaceTestUplink(_ => null));

            Assert.Equal(ChannelEngine.NodeId, engine.NodeFor("keyed.7.screen"));
        }

        /// <summary>
        /// A resolver that throws is contained. It runs inside topic resolution
        /// on the Courier thread, so an escaping exception would take the tick
        /// down for every channel in the engine rather than just this Uplink's.
        /// </summary>
        [Fact]
        public void AThrowingResolverDoesNotEscapeTopicResolution()
        {
            var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new KeyedNamespaceTestUplink(
                _ => throw new InvalidOperationException("resolver blew up")));

            Assert.Equal(ChannelEngine.NodeId, engine.NodeFor("keyed.7.screen"));
        }

        /// <summary>
        /// A per-vessel namespace with no resolver keeps reading its key as the
        /// vessel id, which is how every <c>fleet.&lt;guid&gt;</c> namespace
        /// works and what must not change.
        /// </summary>
        [Fact]
        public void ANamespaceWithoutAResolverStillReadsItsKeyAsTheVesselId()
        {
            var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new KeyedNamespaceTestUplink(null));

            Assert.Equal(
                ChannelEngine.FleetNodePrefix + "7",
                engine.NodeFor("keyed.7.screen"));
        }

        private sealed class KeyedNamespaceTestUplink : ISitrepUplink
        {
            private readonly Func<string, string?>? _resolver;

            internal KeyedNamespaceTestUplink(Func<string, string?>? resolver)
            {
                _resolver = resolver;
            }

            public UplinkHealth Health() => UplinkHealth.Healthy;

            public UplinkManifest Manifest { get; } = new UplinkManifest
            {
                Id = "keyed-namespace-test",
                Version = "1.0.0",
            };

            public void Register(IUplinkHost host)
            {
                host.RegisterDynamicNamespace("keyed.", new ChannelDeclaration
                { Kind = SampleKind.Continuous,
                    Delivery = Delivery.LossyLatest,
                    Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
                    Delay = DelayRole.Delayed,
                    PerVesselNode = true,
                    VesselIdForKey = _resolver,
                });
            }
        }
    }
}
