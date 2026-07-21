using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Sitrep.Contract;
using Sitrep.Host;
using Sitrep.Host.Crash;
using Xunit;

using static Sitrep.Host.IntegrationTests.WsTestHarness;
using StreamData = Sitrep.Contract.StreamData<object?>;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// End-to-end coverage for the crash event stream over the REAL
    /// <see cref="ChannelEngine"/> reliable lane and a REAL ClientWebSocket.
    /// The KSP-facing <c>Gonogo.KSP.CrashUplink</c> can't build headless (it
    /// reads live KSP), so — exactly as <see cref="CommsCoreEndToEndTests"/>
    /// does for comms — a tiny KSP-independent uplink publishes the same
    /// <see cref="CrashPayload.Build"/> dictionary the producer publishes,
    /// proving the spine carries the crash record shape and that the
    /// <see cref="Delivery.ReliableOrdered"/> lane never coalesces two crashes.
    /// </summary>
    public class CrashEndToEndTests
    {
        private static readonly TimeSpan Timeout = TimeSpan.FromSeconds(10);

        private static Dictionary<string, object?> SampleCrash(string vesselId, string eventKind, double ut)
        {
            return CrashPayload.Build(new CrashCapture
            {
                VesselId = vesselId,
                EventKind = eventKind,
                What = "an unidentified object",
                VesselType = "Ship",
                Msg = "",
                Latitude = -0.1127,
                Longitude = -74.3385,
                PartsLost = new List<LostPart>
                {
                    new LostPart { PartId = 960720133, PartName = "mk1pod.v2", PartTitle = "Mk1 Command Pod", Msg = "" },
                },
                Body = "Kerbin",
                FlightStats = new FlightStats
                {
                    PartsLost = 1, FlightEndMode = "CATASTROPHIC_FAILURE", MissionEnd = true,
                    HighestAltitude = 1195.6304, MissionTime = 21.34, HighestSpeed = 368.1807, LiftOff = true,
                },
                VesselName = "career-orbital-test",
                Events = new List<string> { "[00:00:00]: Liftoff!!", "[00:00:21]: crash" },
                KerbalsKilled = new List<string> { "Bill Kerman" },
                Situation = "FLYING",
                CrewAboard = new List<string> { "Bill Kerman" },
                Altitude = -0.5283,
                Ut = ut,
            });
        }

        [Fact]
        public async Task PublishedCrashArrivesOverTheWireWithTheFullNestedShape()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            var uplink = new TestCrashUplink();
            engine.RegisterUplink(uplink);
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, CrashTopics.LastCrashTopic, Timeout);
                await SubscribeAsync(client, CrashTopics.HasRecent, Timeout);

                const double ut = 41486.3595;
                uplink.LastCrash!.Publish(SampleCrash("vessel-a", "CrashSplashdown", ut), ut);
                uplink.HasRecent!.Publish(true, ut);
                engine.TickAndWait(ut, null, Timeout);

                var byTopic = new Dictionary<string, StreamData>();
                for (var i = 0; i < 2; i++)
                {
                    var delivered = await ReceiveStreamDataAsync(client, Timeout);
                    byTopic[delivered.Topic] = delivered;
                }

                Assert.True(byTopic.ContainsKey(CrashTopics.LastCrashTopic));
                Assert.True(byTopic.ContainsKey(CrashTopics.HasRecent));
                Assert.Equal(true, byTopic[CrashTopics.HasRecent].Payload);

                var payload = Assert.IsType<Dictionary<string, object?>>(byTopic[CrashTopics.LastCrashTopic].Payload);
                Assert.Equal("CrashSplashdown", payload["eventKind"]);
                Assert.Equal("Ship", payload["vesselType"]);
                Assert.Equal("career-orbital-test", payload["vesselName"]);

                var parts = Assert.IsType<List<object?>>(payload["partsLost"]);
                var part = Assert.IsType<Dictionary<string, object?>>(Assert.Single(parts));
                Assert.Equal(960720133.0, Convert.ToDouble(part["partId"]));
                Assert.Equal("Mk1 Command Pod", part["partTitle"]);

                var stats = Assert.IsType<Dictionary<string, object?>>(payload["flightStats"]);
                Assert.Equal("CATASTROPHIC_FAILURE", stats["flightEndMode"]);
                Assert.Equal(true, stats["missionEnd"]);
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public async Task ReliableOrderedLaneDeliversTwoDistinctCrashesInOrder()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            var uplink = new TestCrashUplink();
            engine.RegisterUplink(uplink);
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, CrashTopics.LastCrashTopic, Timeout);

                // Two distinct crashes, each published then ticked (mirroring
                // two deaths at different flight times). The ReliableOrdered
                // lane must deliver BOTH, in order — never coalescing the first
                // away the way a LossyLatest channel would if a later value
                // overtook it.
                uplink.LastCrash!.Publish(SampleCrash("vessel-a", "Crash", 100.0), 100.0);
                engine.TickAndWait(100.0, null, Timeout);
                uplink.LastCrash!.Publish(SampleCrash("vessel-b", "Destroyed", 101.0), 101.0);
                engine.TickAndWait(101.0, null, Timeout);

                var frames = await DrainAllStreamDataAsync(client, TimeSpan.FromMilliseconds(500));
                var crashes = frames.FindAll(f => f.Topic == CrashTopics.LastCrashTopic);
                Assert.Equal(2, crashes.Count);

                var firstPayload = Assert.IsType<Dictionary<string, object?>>(crashes[0].Payload);
                var secondPayload = Assert.IsType<Dictionary<string, object?>>(crashes[1].Payload);
                Assert.Equal("Crash", firstPayload["eventKind"]);
                Assert.Equal("vessel-a", firstPayload["vesselId"]);
                Assert.Equal("Destroyed", secondPayload["eventKind"]);
                Assert.Equal("vessel-b", secondPayload["vesselId"]);
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// The KSP-independent stand-in for <c>Gonogo.KSP.CrashUplink</c> — the
        /// same two ReliableOrdered channels, exposed as publishers a test
        /// drives directly (the real uplink drives them from GameEvents).
        /// </summary>
        private sealed class TestCrashUplink : ISitrepUplink
        {
            // Mandatory health floor (test double).
            public UplinkHealth Health() => UplinkHealth.Healthy;

            public IChannelPublisher? LastCrash { get; private set; }
            public IChannelPublisher? HasRecent { get; private set; }

            public UplinkManifest Manifest { get; } = new UplinkManifest
            {
                Id = "test-crash",
                Version = "1.0.0",
                Channels = new List<ChannelDeclaration>
                {
                    Channel(CrashTopics.LastCrashTopic),
                    Channel(CrashTopics.HasRecent),
                },
            };

            private static ChannelDeclaration Channel(string topic) => new ChannelDeclaration
            {
                Topic = topic,
                Delivery = Delivery.ReliableOrdered,
                Delay = DelayRole.Delayed,
                Emission = new EmissionPolicy(keyframeIntervalUt: 3600, quantum: EmissionQuantum.Absolute(0)),
            };

            public void Register(IUplinkHost host)
            {
                LastCrash = host.Publisher(CrashTopics.LastCrashTopic);
                HasRecent = host.Publisher(CrashTopics.HasRecent);
            }
        }
    }
}
