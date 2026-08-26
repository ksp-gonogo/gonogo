using System;
using System.Threading.Tasks;
using Sitrep.Contract;
using Sitrep.Core;
using Sitrep.Core.Serialization;
using Sitrep.Host;
using Xunit;
using static Sitrep.Host.IntegrationTests.WsTestHarness;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// The subscription gate has to CLOSE again, and by the same rule it opened by.
    ///
    /// <para><b>The failure this exists to catch, and it is the mirror of
    /// starvation.</b> Every gated capture is skipped while nothing under its
    /// prefixes is subscribed, and there are tests for that. Nothing asked whether
    /// the topic ever leaves the subscribed set. If a refcount can leak upward, on
    /// an unsubscribe or on a dropped connection, the gate is permanently satisfied
    /// from the first subscriber onwards: the capture runs forever in a session
    /// where nobody is watching, and every later assertion that the gate skips is
    /// meaningless because the gate never skips anything again.</para>
    ///
    /// <para>That is not a starvation, it is its opposite, and it costs main-thread
    /// frame time on a walk nobody asked for. It matters here because a gate that
    /// cannot close makes the whole early-out unmeasurable: a passing "it skips
    /// while unsubscribed" case would only ever be reporting the state BEFORE the
    /// first subscriber.</para>
    ///
    /// <para>Two ways a subscriber goes: it says so, and it vanishes. The second is
    /// the one a peer-driven client actually does most often, and the one where a
    /// refcount has the furthest to fall.</para>
    /// </summary>
    public class GatedCaptureReleaseTests
    {
        private static readonly TimeSpan Timeout = TimeSpan.FromSeconds(5);

        [Fact]
        public async Task AGatedCaptureStopsRunningOnceItsLastSubscriberUnsubscribes()
        {
            var uplink = new SampledGateTestUplink();
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(uplink);
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);

                await SubscribeAsync(client, SampledGateTestUplink.Topic, Timeout);
                engine.TickAndWait(1.0, new KspSnapshot { Ut = 1.0 }, Timeout);
                Assert.True(
                    uplink.CaptureCount >= 1,
                    "the gate must be open while the topic is subscribed, or this case is "
                    + "measuring nothing when it closes");

                await client.SendAsync(EnvelopeCodec.WriteUnsubscribe(
                    new Unsubscribe { Topic = SampledGateTestUplink.Topic }));

                AssertCaptureStops(engine, uplink);
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public async Task AGatedCaptureStopsRunningOnceItsLastSubscriberDISCONNECTS()
        {
            // A client that vanishes never sends the unsubscribe, so the release
            // has to come off the session teardown instead. This is the path a
            // dropped peer takes, and the one where a leaked refcount would leave
            // the gate open for the rest of the process.
            var uplink = new SampledGateTestUplink();
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(uplink);
            engine.Start();
            try
            {
                var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, SampledGateTestUplink.Topic, Timeout);
                engine.TickAndWait(1.0, new KspSnapshot { Ut = 1.0 }, Timeout);
                Assert.True(uplink.CaptureCount >= 1, "the gate must be open before it can be seen to close");

                await client.DisposeAsync();

                AssertCaptureStops(engine, uplink);
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// Ticks until the capture count stops moving, then holds it still for
        /// several more ticks.
        ///
        /// <para>Bounded rather than awaited on a signal, because neither a
        /// released subscription nor an ended session raises one: the gate reads a
        /// mirror written on the Courier, and a send returning says the bytes left,
        /// not that they were acted on. So the lag is measured rather than assumed,
        /// which also keeps this honest about the failure it is looking for: a gate
        /// that never closes never settles, the loop runs out, and the case fails
        /// naming the count that was still climbing. Waiting a fixed number of ticks
        /// instead would pass on any lag shorter than the wait and say nothing about
        /// a gate stuck open.</para>
        /// </summary>
        private static void AssertCaptureStops(ChannelEngine engine, SampledGateTestUplink uplink)
        {
            var ut = 10.0;
            for (var attempt = 0; attempt < 20; attempt++)
            {
                var before = uplink.CaptureCount;
                engine.TickAndWait(ut, new KspSnapshot { Ut = ut }, Timeout);
                ut += 1.0;
                if (uplink.CaptureCount != before)
                {
                    continue;
                }

                for (var held = 0; held < 4; held++)
                {
                    engine.TickAndWait(ut, new KspSnapshot { Ut = ut }, Timeout);
                    ut += 1.0;
                }

                Assert.Equal(before, uplink.CaptureCount);
                return;
            }

            Assert.Fail(
                "the capture never stopped running after its last subscriber went: the "
                + "gate has been left permanently open, so every reading of it from here "
                + "on says nothing about what is subscribed (still climbing at "
                + uplink.CaptureCount + " captures)");
        }
    }
}
