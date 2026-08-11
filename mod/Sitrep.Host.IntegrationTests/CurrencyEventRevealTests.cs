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
    /// Source-attributed currency events under delay: a currency delta caused by a
    /// specific vessel is revealed at THAT vessel's own light-time, not instantly and
    /// not at the observer's ambient vantage delay. Driven by
    /// <see cref="CurrencyEventTestUplink"/> over the real WS harness (the same shape
    /// as <see cref="RevealGateTests"/> / <see cref="FleetDelayTests"/>).
    ///
    /// <para>The escape hatch these close: <c>career.status.economy.science</c> is
    /// TrueNow (it gates what tech the operator can afford, so it must be
    /// ground-truth), while the vessel telemetry confirming a transmit is Delayed. An
    /// operator watching the total could infer a distant event a full return
    /// light-time early. These tests pin that the new event does NOT arrive before its
    /// source vessel's light-time, and that the instant channel is untouched.</para>
    /// </summary>
    public class CurrencyEventRevealTests
    {
        private static readonly TimeSpan Timeout = TimeSpan.FromSeconds(10);
        private static readonly TimeSpan Quiet = TimeSpan.FromMilliseconds(500);

        private static double? Latest(IEnumerable<StreamData> frames, string topic)
        {
            var match = frames.LastOrDefault(f => f.Topic == topic && f.Payload != null);
            return match == null ? (double?)null : Convert.ToDouble(match.Payload);
        }

        [Theory]
        // A currency event routes to the SAME per-vessel node that vessel's telemetry
        // uses, so the ledger applies that vessel's own DelayTo.
        [InlineData("currency.abc-123.science", "fleet.abc-123")]
        [InlineData("currency.abc-123.reputation", "fleet.abc-123")]
        // The same vessel's fleet telemetry shares the node: one clock per vessel.
        [InlineData("fleet.abc-123.orbit", "fleet.abc-123")]
        // No field segment after the guid is not a channel, so it does not invent a node.
        [InlineData("currency.abc-123", "system")]
        [InlineData("currency.", "system")]
        // The instant career total is NOT per-vessel and stays on the single node.
        [InlineData("career.status", "system")]
        public void NodeForTopicRoutesCurrencyEventsToTheirSourceVesselsNode(string topic, string expectedNode)
        {
            Assert.Equal(expectedNode, ChannelEngine.NodeForTopic(topic));
        }

        [Fact]
        public async Task ScienceCreditIsWithheldUntilTheSourceVesselsLightTimeElapses()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new CurrencyEventTestUplink());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, CurrencyEventTopics.Science("probe"), Timeout);

                // The probe is 4 light-seconds out. Arm its node delay first, with no
                // credit, so the delay is in the ledger before the event is recorded.
                engine.TickAndWait(0.0, Fixture(0.0, delay: 4.0), Timeout);

                // The credit happens at UT 1. Its reveal horizon is UT 5.
                engine.TickAndWait(1.0, Fixture(1.0, delay: 4.0, creditAmount: 7.8), Timeout);
                var atCredit = await DrainAllStreamDataAsync(client, Quiet);
                Assert.DoesNotContain(atCredit, f => f.Topic == CurrencyEventTopics.Science("probe"));

                // Still withheld right up to the horizon: the operator cannot learn the
                // distant probe banked science before its light-time has elapsed.
                for (var ut = 2.0; ut <= 4.0; ut += 1.0)
                {
                    engine.TickAndWait(ut, Fixture(ut, delay: 4.0), Timeout);
                }
                var beforeHorizon = await DrainAllStreamDataAsync(client, Quiet);
                Assert.DoesNotContain(beforeHorizon, f => f.Topic == CurrencyEventTopics.Science("probe"));

                // At UT 5 the horizon reaches the UT-1 event and it reveals, intact.
                engine.TickAndWait(5.0, Fixture(5.0, delay: 4.0), Timeout);
                var atHorizon = await DrainAllStreamDataAsync(client, Quiet);
                var revealed = atHorizon.LastOrDefault(f => f.Topic == CurrencyEventTopics.Science("probe"));
                Assert.NotNull(revealed);
                var payload = Assert.IsType<Dictionary<string, object?>>(revealed!.Payload);
                Assert.Equal("probe", payload["vesselId"]);
                Assert.Equal(7.8, payload["amount"]);
                // The event carries the UT it HAPPENED at, not the UT it arrived at, so a
                // consumer can label it "5s ago" rather than "now".
                Assert.Equal(1.0, payload["ut"]);
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public async Task ScienceCreditFromAVesselAtKscIsInstant()
        {
            // The delay is real, not a fixed artificial hold: a vessel sitting at KSC
            // has zero light-time, so its credit is revealed live. This is what keeps
            // the feature invisible in early-career play (and with delay disabled).
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new CurrencyEventTestUplink());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, CurrencyEventTopics.Science("onpad"), Timeout);

                engine.TickAndWait(0.0, Fixture(0.0, delay: 0.0), Timeout);
                engine.TickAndWait(1.0, Fixture(1.0, delay: 0.0, creditAmount: 2.5), Timeout);
                engine.TickAndWait(2.0, Fixture(2.0, delay: 0.0), Timeout);

                var frames = await DrainAllStreamDataAsync(client, Quiet);
                var arrived = frames.LastOrDefault(f => f.Topic == CurrencyEventTopics.Science("onpad"));
                Assert.NotNull(arrived);
                var payload = Assert.IsType<Dictionary<string, object?>>(arrived!.Payload);
                Assert.Equal(2.5, payload["amount"]);
                // Revealed at the UT it happened: zero light-time means zero hold, so the
                // event is not artificially deferred to a later UT.
                Assert.Equal(1.0, arrived.Meta.ValidAt);
                Assert.Equal(1.0, arrived.Meta.DeliveredAt);
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public async Task TwoVesselsCreditsAreEachDelayedByTheirOwnLightTime()
        {
            // The point of source attribution: two credits banked in the same tick
            // arrive on DIFFERENT clocks, each its own source's. A single shared delay
            // (or the observer's ambient one) could not produce this.
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new CurrencyEventTestUplink());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, CurrencyEventTopics.Science("near"), Timeout);
                await SubscribeAsync(client, CurrencyEventTopics.Science("far"), Timeout);

                engine.TickAndWait(0.0, TwoVesselFixture(0.0, credit: false), Timeout);
                engine.TickAndWait(1.0, TwoVesselFixture(1.0, credit: true), Timeout);
                for (var ut = 2.0; ut <= 8.0; ut += 1.0)
                {
                    engine.TickAndWait(ut, TwoVesselFixture(ut, credit: false), Timeout);
                }

                var frames = await DrainAllStreamDataAsync(client, Quiet);
                var near = frames.Where(f => f.Topic == CurrencyEventTopics.Science("near")).ToList();
                var far = frames.Where(f => f.Topic == CurrencyEventTopics.Science("far")).ToList();
                Assert.NotEmpty(near);
                Assert.NotEmpty(far);
                var nearArrival = near.Min(f => f.Meta.DeliveredAt);
                var farArrival = far.Min(f => f.Meta.DeliveredAt);
                Assert.True(nearArrival < farArrival,
                    $"near arrived at {nearArrival}, far at {farArrival} -- expected near strictly earlier");
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public async Task TheInstantCurrencyTotalIsUnaffectedByTheDelayedEvent()
        {
            // The HARD constraint: the gating-facing career total stays instant. A
            // delayed narrative event is ADDITIVE, never a reclassification. Here a
            // TrueNow channel and a far vessel's currency event ride the same engine and
            // the same ticks: the TrueNow value is live while the event is still in
            // flight, which is exactly the split the design requires (the operator keeps
            // seeing the number the game will gate a spend against).
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new CurrencyEventTestUplink());
            engine.RegisterUplink(new RevealGateTestUplink());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, RevealGateTestUplink.TrueNowTopic, Timeout);
                await SubscribeAsync(client, CurrencyEventTopics.Science("probe"), Timeout);

                engine.TickAndWait(0.0, Fixture(0.0, delay: 4.0), Timeout);
                engine.TickAndWait(1.0, WithTrueNow(Fixture(1.0, delay: 4.0, creditAmount: 7.8), 245.3), Timeout);

                var frames = await DrainAllStreamDataAsync(client, Quiet);
                // The instant total arrived on the same tick it changed.
                Assert.Equal(245.3, Latest(frames, RevealGateTestUplink.TrueNowTopic));
                // The source-attributed event has NOT: it is still crossing 4 light-seconds.
                Assert.DoesNotContain(frames, f => f.Topic == CurrencyEventTopics.Science("probe"));
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// A snapshot carrying one vessel ("probe"/"onpad", keyed by the caller's
        /// subscribe) with <paramref name="delay"/> one-way seconds, and optionally a
        /// science credit of <paramref name="creditAmount"/> at this UT.
        /// </summary>
        private static KspSnapshot Fixture(double ut, double delay, double? creditAmount = null)
        {
            var vessels = new List<object?>
            {
                new Dictionary<string, object?> { ["id"] = "probe", ["delay"] = delay },
                new Dictionary<string, object?> { ["id"] = "onpad", ["delay"] = delay },
            };
            var credits = new List<object?>();
            if (creditAmount.HasValue)
            {
                credits.Add(new Dictionary<string, object?> { ["vesselId"] = "probe", ["amount"] = creditAmount.Value });
                credits.Add(new Dictionary<string, object?> { ["vesselId"] = "onpad", ["amount"] = creditAmount.Value });
            }
            return new KspSnapshot
            {
                Ut = ut,
                Values = new Dictionary<string, object?> { ["vessels"] = vessels, ["credits"] = credits },
            };
        }

        /// <summary>Two vessels at different light-times, both crediting on the same tick.</summary>
        private static KspSnapshot TwoVesselFixture(double ut, bool credit)
        {
            var vessels = new List<object?>
            {
                new Dictionary<string, object?> { ["id"] = "near", ["delay"] = 2.0 },
                new Dictionary<string, object?> { ["id"] = "far", ["delay"] = 6.0 },
            };
            var credits = new List<object?>();
            if (credit)
            {
                credits.Add(new Dictionary<string, object?> { ["vesselId"] = "near", ["amount"] = 3.0 });
                credits.Add(new Dictionary<string, object?> { ["vesselId"] = "far", ["amount"] = 9.0 });
            }
            return new KspSnapshot
            {
                Ut = ut,
                Values = new Dictionary<string, object?> { ["vessels"] = vessels, ["credits"] = credits },
            };
        }

        /// <summary>Adds the RevealGateTestUplink's TrueNow value to an existing fixture.</summary>
        private static KspSnapshot WithTrueNow(KspSnapshot snapshot, double trueNow)
        {
            snapshot.Values["truenow"] = trueNow;
            return snapshot;
        }
    }
}
