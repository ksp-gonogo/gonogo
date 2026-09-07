using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Sitrep.Contract;
using Sitrep.Host;
using Sitrep.Host.Comms;
using Xunit;

using static Sitrep.Host.IntegrationTests.WsTestHarness;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// U5 "Layer A" synthetic end-to-end coverage for the CORE comms surface,
    /// the KSP-INDEPENDENT half of <c>Gonogo.KSP.CommsCoreUplink</c>. The real
    /// uplink is net472/KSP-facing (it hard-references the live-KSP
    /// <c>CommNetBackend</c>), so it can't build headless; this suite proves
    /// everything the uplink does that ISN'T the live backend:
    /// <list type="bullet">
    /// <item>the exclusive <c>"comms"</c> capability ELECTION
    /// (<see cref="CommsElection"/>) resolves an <see cref="ICommsBackend"/>
    /// through the real <see cref="ChannelEngine"/> two-pass discovery path;</item>
    /// <item>the core <see cref="SignalDelay"/> light-time math over that
    /// backend's <see cref="CommsPath"/> geometry is delivered as the
    /// <c>comms.delay</c> payload over a REAL ClientWebSocket, with the correct
    /// one-way seconds and <see cref="CommsDelaySource.SignalDelay"/> provenance;</item>
    /// <item><c>comms.delay</c> is DELAYED, revealed one light-time after the
    /// tick it was computed on. Gating it is not circular: what carries every
    /// Delayed channel is the engine's ledger, which the capture pass writes,
    /// and this channel is a readout off the same numbers.</item>
    /// </list>
    ///
    /// <para>Only <c>comms.delay</c> travels the wire here: it is the single
    /// <c>comms.*</c> payload <see cref="Sitrep.Core.Serialization.JsonWriter"/>
    /// flattens today. The remaining shared readouts
    /// (<see cref="ICommsBackend.Connectivity"/> / <c>SignalStrength</c> /
    /// <c>ControlState</c> / <c>Path</c> / <c>Network</c>) are proven at the
    /// contract/election level below (the elected backend supplies them all),
    /// which is where their KSP-independent surface actually lives, their
    /// live-backend values and their eventual wire flattening are KSP-facing
    /// concerns deferred to the Deck DLLs.</para>
    /// </summary>
    public class CommsCoreEndToEndTests
    {
        private static readonly TimeSpan Timeout = TimeSpan.FromSeconds(10);
        private static readonly TimeSpan Quiet = TimeSpan.FromMilliseconds(500);

        // Kerbin-to-Mun-ish one-way distance: a realistic non-zero hop.
        private const double HopDistanceMeters = 12_000_000.0;

        private static ChannelEngine EngineWith(TestCommsCoreUplink uplink, double networkDelaySeconds = 0)
        {
            var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds);
            engine.RegisterDiscoveredUplinks(new List<UplinkDiscovery.DiscoveredUplink>
            {
                new UplinkDiscovery.DiscoveredUplink(uplink, ContractVersion.Major, ContractVersion.Minor),
            });
            engine.ResolveCapabilities();
            return engine;
        }

        /// <summary>
        /// The delay reaches the wire one light-time after the geometry that
        /// produced it, carrying its own <c>ValidAt</c>. This is the test that
        /// would have caught the classification silently reverting: it fails on
        /// a TrueNow <c>comms.delay</c>, because the frame then arrives on the
        /// emitting tick.
        /// </summary>
        [Fact]
        public async Task CommsDelayFromElectedBackendGeometryArrivesOneLightTimeAfterItWasMeasured()
        {
            var uplink = new TestCommsCoreUplink(HopDistanceMeters, signalDelayEnabled: true);
            using var engine = EngineWith(uplink);

            // The election resolved a backend before the first tick, the same
            // Kernel.Query the comms.delay source uses each tick.
            var elected = CommsElection.Elected(engine.Kernel);
            Assert.NotNull(elected);
            Assert.Equal("commnet", elected!.ProviderId);

            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, TestCommsCoreUplink.DelayTopic, Timeout);

                const double ut = 3.0;
                engine.TickAndWait(ut, new KspSnapshot { Ut = ut }, Timeout);

                // Nothing on the emitting tick: the ledger holds it for the
                // light-time the payload itself reports.
                Assert.Empty(await DrainAllStreamDataAsync(client, Quiet));

                // One light-time later it lands, stamped with the UT it was
                // measured at rather than the UT it arrived at.
                var horizon = ut + uplink.ExpectedOneWaySeconds;
                engine.TickAndWait(horizon, new KspSnapshot { Ut = horizon }, Timeout);
                var frames = await DrainAllStreamDataAsync(client, Timeout);
                var delivered = Assert.Single(frames, f => f.Topic == TestCommsCoreUplink.DelayTopic);

                Assert.Equal(ut, delivered.Meta.ValidAt);

                // The CommsDelay POCO is flattened by JsonWriter to
                // { oneWaySeconds, source, meta:{ source, quality } }, source
                // is the enum ordinal (SignalDelay == 1).
                var payload = Assert.IsType<Dictionary<string, object?>>(delivered.Payload);
                Assert.Equal(uplink.ExpectedOneWaySeconds, Convert.ToDouble(payload["oneWaySeconds"]), precision: 6);
                Assert.True(uplink.ExpectedOneWaySeconds > 0, "sanity: the synthetic hop must produce a non-zero delay");
                Assert.Equal((double)(int)CommsDelaySource.SignalDelay, Convert.ToDouble(payload["source"]));
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// SignalDelay flag OFF ⇒ <c>comms.delay</c> is still emitted (the
        /// authority is always present) but carries 0 seconds /
        /// <see cref="CommsDelaySource.None"/>: the "no delay authority" state
        /// a consumer reads as pass-through, never mistaking the 0 for a
        /// measured zero-distance delay.
        /// </summary>
        [Fact]
        public async Task CommsDelayWithSignalDelayDisabledReportsNoneOverTheWire()
        {
            var uplink = new TestCommsCoreUplink(HopDistanceMeters, signalDelayEnabled: false);
            using var engine = EngineWith(uplink);
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, TestCommsCoreUplink.DelayTopic, Timeout);

                const double ut = 1.0;
                engine.TickAndWait(ut, new KspSnapshot { Ut = ut }, Timeout);
                var delivered = await ReceiveStreamDataAsync(client, Timeout);

                var payload = Assert.IsType<Dictionary<string, object?>>(delivered.Payload);
                Assert.Equal(0.0, Convert.ToDouble(payload["oneWaySeconds"]));
                Assert.Equal((double)(int)CommsDelaySource.None, Convert.ToDouble(payload["source"]));
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// The election + shared-readout contract, KSP-independent: the
        /// vanilla-CommNet-shaped backend the election picks exposes every
        /// readout <see cref="ICommsBackend"/> requires, and its
        /// <see cref="ICommsBackend.Path"/> carries the hop geometry
        /// <see cref="SignalDelay"/> integrates over. This is the coverage for
        /// the shared <c>comms.*</c> readouts that don't (yet) have a wire
        /// flatten: asserted against the SAME elected instance the wire
        /// <c>comms.delay</c> above is derived from.
        /// </summary>
        [Fact]
        public void ElectedBackendExposesSharedReadoutsWithHopGeometry()
        {
            var uplink = new TestCommsCoreUplink(HopDistanceMeters, signalDelayEnabled: true);
            var engine = EngineWith(uplink);

            Assert.True(engine.AvailabilityOf("test-comms").IsAvailable);
            var backend = CommsElection.Elected(engine.Kernel);
            Assert.NotNull(backend);

            Assert.True(backend!.Connectivity().Connected);
            Assert.Equal(CommsControlStateKind.Full, backend.ControlState().State);
            Assert.InRange(backend.SignalStrength().Value, 0.0, 1.0);

            var path = backend.Path();
            var hop = Assert.Single(path.Hops);
            Assert.Equal(HopDistanceMeters, hop.DistanceMeters);

            // The core SignalDelay math over that same geometry matches the
            // uplink's advertised expectation (and the wire value above).
            var delay = SignalDelay.Compute(
                new SignalDelayConfig { Enabled = true, LightSpeedScale = 1.0 },
                path, "game", Quality.Loaded);
            Assert.Equal(CommsDelaySource.SignalDelay, delay.Source);
            Assert.NotNull(delay.OneWaySeconds);
            Assert.Equal(uplink.ExpectedOneWaySeconds, delay.OneWaySeconds!.Value, precision: 6);

            // This test never Start()s the engine (pure election/contract
            // inspection), so Dispose()'s Stop() would Join a never-started
            // Courier thread: tear down explicitly-safe by not disposing.
            _ = engine;
        }
    }
}
