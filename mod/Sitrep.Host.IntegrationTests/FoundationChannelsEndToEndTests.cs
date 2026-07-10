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
    /// U5 "Layer A" synthetic end-to-end coverage for the FOUNDATION channels —
    /// the vessel/system/career/science/parts core surface that needs no
    /// KSP-facing uplink. Each test subscribes a real
    /// <see cref="System.Net.WebSockets.ClientWebSocket"/> to a channel,
    /// ticks ONE hand-authored synthetic <see cref="KspSnapshot"/> through the
    /// real production mapper (the same <c>*ViewProvider</c> the in-game uplink
    /// registers, wired via this project's KSP-free <c>Test*Uplink</c> replicas),
    /// and asserts BOTH the payload shape AND the envelope <see cref="Meta"/>
    /// that arrives on the wire.
    ///
    /// <para><b>Meta on the wire</b> (<c>Sitrep.Core.Courier.MakeMeta</c>):
    /// <see cref="Meta.Source"/> is the Courier node id
    /// (<see cref="ChannelEngine.NodeId"/> = <c>"system"</c>) — NOT the topic
    /// and NOT the payload's own <c>PayloadMeta.Source</c>; <see cref="Meta.ValidAt"/>
    /// is the UT the sample was recorded at (the tick UT); <see cref="Meta.Seq"/>
    /// is a strictly-increasing per-Courier sequence counter (&gt; 0 on the
    /// first delivery). With <c>networkDelaySeconds: 0</c> the sample is
    /// revealed live, so <see cref="Meta.DeliveredAt"/> equals
    /// <see cref="Meta.ValidAt"/>.</para>
    ///
    /// <para>This is the KSP-INDEPENDENT proof that the integrated spine
    /// (mapper → ChannelEngine → Fleck WS → real ClientWebSocket) carries a
    /// synthetic snapshot to the wire with correct payload + Meta for every
    /// foundation domain. Per-uplink live validation for the KSP-FACING
    /// channels (SCANsat / kOS / RealAntennas-specific) waits on the Deck DLLs
    /// — see <c>RevealGateTests</c> / this suite's report for the deferred
    /// list.</para>
    /// </summary>
    public class FoundationChannelsEndToEndTests
    {
        private static readonly TimeSpan Timeout = TimeSpan.FromSeconds(10);

        private static void AssertLiveMeta(StreamData delivered, string topic, double ut)
        {
            Assert.Equal(topic, delivered.Topic);
            // Envelope Source is the Courier NODE id, stamped by MakeMeta for
            // every channel regardless of topic.
            Assert.Equal(ChannelEngine.NodeId, delivered.Meta.Source);
            Assert.Equal(ut, delivered.Meta.ValidAt);
            // networkDelaySeconds:0 ⇒ revealed live, delivered at its own UT.
            Assert.Equal(ut, delivered.Meta.DeliveredAt);
            // Seq is a real, monotonic per-Courier counter — never the
            // fabricated 0 a payload's own PayloadMeta used to carry.
            Assert.True(delivered.Meta.Seq > 0, $"expected a positive envelope Seq, saw {delivered.Meta.Seq}");
        }

        /// <summary>
        /// Runs ONE synthetic snapshot through the given uplinks and returns the
        /// single StreamData delivered for <paramref name="topic"/>. Subscribes
        /// via <see cref="WsTestHarness.SubscribeAsync"/> (which consumes the
        /// subscribe ack) then the tick's keyframe is the next frame.
        /// </summary>
        private static async Task<StreamData> TickOneAndReceiveAsync(
            IEnumerable<ISitrepUplink> uplinks,
            string topic,
            double ut,
            KspSnapshot snapshot)
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            foreach (var uplink in uplinks)
            {
                engine.RegisterUplink(uplink);
            }
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, topic, Timeout);
                engine.TickAndWait(ut, snapshot, Timeout);
                return await ReceiveStreamDataAsync(client, Timeout);
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public async Task VesselIdentityAndFlightFlowThroughRealMappersWithCorrectMeta()
        {
            const double ut = 42.0;
            const string guid = "11111111-2222-3333-4444-555555555555";
            var snapshot = new KspSnapshot
            {
                Ut = ut,
                Values = new Dictionary<string, object?>
                {
                    ["vessel"] = new Dictionary<string, object?>
                    {
                        ["identity"] = new Dictionary<string, object?>
                        {
                            ["id"] = guid,
                            ["name"] = "Jebediah's Junker",
                            ["vesselType"] = "Ship",
                            ["situation"] = "ORBITING",
                        },
                        // BuildFlight returns null unless EVERY field is
                        // present (R1: never a partially-populated record), so
                        // the full set is supplied.
                        ["flight"] = new Dictionary<string, object?>
                        {
                            ["missionTime"] = 40.0,
                            ["latitude"] = 0.5,
                            ["longitude"] = -74.0,
                            ["altitudeAsl"] = 72_000.0,
                            ["altitudeTerrain"] = 71_400.0,
                            ["verticalSpeed"] = 3.2,
                            ["surfaceSpeed"] = 2_284.0,
                            ["orbitalSpeed"] = 2_290.0,
                            ["gForce"] = 1.0,
                            ["dynamicPressure"] = 0.0,
                            ["mach"] = 0.0,
                            ["atmDensity"] = 0.0,
                            ["externalTemperature"] = 288.0,
                            ["atmosphericTemperature"] = 250.0,
                        },
                    },
                },
            };

            // vessel.identity
            var identity = await TickOneAndReceiveAsync(
                new ISitrepUplink[] { new TestVesselUplink() }, VesselViewProvider.IdentityTopic, ut, snapshot);
            AssertLiveMeta(identity, VesselViewProvider.IdentityTopic, ut);
            var idPayload = Assert.IsType<Dictionary<string, object?>>(identity.Payload);
            Assert.Equal(guid, idPayload["vesselId"]);
            Assert.Equal("Jebediah's Junker", idPayload["name"]);
            // The payload's OWN PayloadMeta.Source is the vessel provenance —
            // distinct from the envelope Source asserted above.
            var idMeta = Assert.IsType<Dictionary<string, object?>>(idPayload["meta"]);
            Assert.Equal("vessel:" + guid, idMeta["source"]);

            // vessel.flight
            var flight = await TickOneAndReceiveAsync(
                new ISitrepUplink[] { new TestVesselUplink() }, VesselViewProvider.FlightTopic, ut, snapshot);
            AssertLiveMeta(flight, VesselViewProvider.FlightTopic, ut);
            var flightPayload = Assert.IsType<Dictionary<string, object?>>(flight.Payload);
            Assert.Equal(72_000.0, flightPayload["altitudeAsl"]);
        }

        [Fact]
        public async Task SystemBodiesFlowsThroughRealMapperWithCorrectMeta()
        {
            const double ut = 7.0;
            var snapshot = new KspSnapshot
            {
                Ut = ut,
                Values = new Dictionary<string, object?>
                {
                    ["bodies"] = new List<object?>
                    {
                        new Dictionary<string, object?>
                        {
                            ["name"] = "Kerbol",
                            ["index"] = 0,
                            ["radius"] = 261_600_000.0,
                        },
                        new Dictionary<string, object?>
                        {
                            ["name"] = "Kerbin",
                            ["index"] = 1,
                            ["parentIndex"] = 0,
                            ["radius"] = 600_000.0,
                            ["sma"] = 13_599_840_256.0,
                            ["ecc"] = 0.0,
                            ["inc"] = 0.0,
                            ["lan"] = 0.0,
                            ["argPe"] = 0.0,
                            ["meanAnomalyAtEpoch"] = 0.0,
                            ["epoch"] = 0.0,
                        },
                    },
                },
            };

            var delivered = await TickOneAndReceiveAsync(
                new ISitrepUplink[] { new TestSystemUplink() }, SystemViewProvider.Topic, ut, snapshot);
            AssertLiveMeta(delivered, SystemViewProvider.Topic, ut);
            var payload = Assert.IsType<Dictionary<string, object?>>(delivered.Payload);
            var bodies = Assert.IsType<List<object?>>(payload["bodies"]);
            Assert.Equal(2, bodies.Count);
            var planet = Assert.IsType<Dictionary<string, object?>>(bodies[1]);
            var orbit = Assert.IsType<Dictionary<string, object?>>(planet["orbit"]);
            Assert.Equal(13_599_840_256.0, orbit["sma"]);
        }

        [Fact]
        public async Task CareerStatusFlowsThroughRealMapperWithCorrectMeta()
        {
            const double ut = 100.0;
            var snapshot = new KspSnapshot
            {
                Ut = ut,
                Values = new Dictionary<string, object?>
                {
                    ["career"] = new Dictionary<string, object?>
                    {
                        ["economy"] = new Dictionary<string, object?>
                        {
                            ["funds"] = 289_848.0,
                            ["reputation"] = 55.0,
                            ["science"] = 120.0,
                        },
                    },
                },
            };

            var delivered = await TickOneAndReceiveAsync(
                new ISitrepUplink[] { new TestCareerUplink() }, CareerViewProvider.Topic, ut, snapshot);
            AssertLiveMeta(delivered, CareerViewProvider.Topic, ut);
            var payload = Assert.IsType<Dictionary<string, object?>>(delivered.Payload);
            var economy = Assert.IsType<Dictionary<string, object?>>(payload["economy"]);
            Assert.Equal(289_848.0, economy["funds"]);
        }

        [Fact]
        public async Task ScienceExperimentsFlowsThroughRealMapperWithCorrectMeta()
        {
            const double ut = 55.0;
            var snapshot = new KspSnapshot
            {
                Ut = ut,
                Values = new Dictionary<string, object?>
                {
                    ["science"] = new Dictionary<string, object?>
                    {
                        ["experiments"] = new List<object?>
                        {
                            new Dictionary<string, object?>
                            {
                                ["partName"] = "Mystery Goo Containment Unit",
                                ["location"] = "experiment",
                                ["experimentId"] = "mysteryGoo",
                                ["subjectId"] = "mysteryGoo@KerbinSrfLandedLaunchPad",
                                ["title"] = "Mystery Goo Observation",
                                ["situation"] = "SrfLanded",
                            },
                        },
                    },
                },
            };

            var delivered = await TickOneAndReceiveAsync(
                new ISitrepUplink[] { new TestScienceUplink() }, ScienceViewProvider.ExperimentsTopic, ut, snapshot);
            AssertLiveMeta(delivered, ScienceViewProvider.ExperimentsTopic, ut);
            // BuildExperiments's payload IS the entry list itself, not a
            // wrapping dict.
            var entries = Assert.IsType<List<object?>>(delivered.Payload);
            var entry = Assert.IsType<Dictionary<string, object?>>(entries[0]);
            Assert.Equal("mysteryGoo", entry["experimentId"]);
        }

        [Fact]
        public async Task PartsPowerFlowsThroughRealMapperWithCorrectMeta()
        {
            const double ut = 12.5;
            var snapshot = new KspSnapshot
            {
                Ut = ut,
                Values = new Dictionary<string, object?>
                {
                    ["parts"] = new Dictionary<string, object?>
                    {
                        ["power"] = new Dictionary<string, object?>
                        {
                            ["totalProductionEc"] = 8.5,
                            ["solarPanels"] = new List<object?>
                            {
                                new Dictionary<string, object?>
                                {
                                    ["partName"] = "OX-STAT Photovoltaic Panels",
                                    ["partId"] = "12345",
                                    ["deployState"] = "EXTENDED",
                                    ["chargeRate"] = 0.35,
                                },
                            },
                        },
                    },
                },
            };

            var delivered = await TickOneAndReceiveAsync(
                new ISitrepUplink[] { new TestPartsUplink() }, PartsViewProvider.PowerTopic, ut, snapshot);
            AssertLiveMeta(delivered, PartsViewProvider.PowerTopic, ut);
            var payload = Assert.IsType<Dictionary<string, object?>>(delivered.Payload);
            Assert.Equal(8.5, payload["totalProductionEc"]);
            var panels = Assert.IsType<List<object?>>(payload["solarPanels"]);
            var panel = Assert.IsType<Dictionary<string, object?>>(panels[0]);
            Assert.Equal("OX-STAT Photovoltaic Panels", panel["partName"]);
        }

        /// <summary>
        /// The envelope <see cref="Meta.Seq"/> strictly increases across
        /// successive deliveries on the SAME Courier — proving the sequence
        /// counter on the wire is real and monotonic, not a per-payload
        /// fabrication. Two ticks, two frames, ascending Seq.
        /// </summary>
        [Fact]
        public async Task EnvelopeSeqStrictlyIncreasesAcrossTicks()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new TestCareerUplink());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, CareerViewProvider.Topic, Timeout);

                KspSnapshot Snapshot(double funds, double ut) => new KspSnapshot
                {
                    Ut = ut,
                    Values = new Dictionary<string, object?>
                    {
                        ["career"] = new Dictionary<string, object?>
                        {
                            ["economy"] = new Dictionary<string, object?> { ["funds"] = funds },
                        },
                    },
                };

                engine.TickAndWait(1.0, Snapshot(100.0, 1.0), Timeout);
                var first = await ReceiveStreamDataAsync(client, Timeout);
                engine.TickAndWait(2.0, Snapshot(200.0, 2.0), Timeout);
                var second = await ReceiveStreamDataAsync(client, Timeout);

                Assert.True(second.Meta.Seq > first.Meta.Seq,
                    $"expected ascending Seq, saw {first.Meta.Seq} then {second.Meta.Seq}");
                Assert.Equal(1.0, first.Meta.ValidAt);
                Assert.Equal(2.0, second.Meta.ValidAt);
            }
            finally
            {
                engine.Stop();
            }
        }
    }
}
