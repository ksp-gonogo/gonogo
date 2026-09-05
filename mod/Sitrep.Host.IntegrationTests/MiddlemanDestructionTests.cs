using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Sitrep.Host;
using Xunit;

using static Sitrep.Host.IntegrationTests.WsTestHarness;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// THE MIDDLEMAN DESTRUCTION, over the raw wire, end to end.
    /// <see cref="MiddlemanRerouteTests"/> covers a relay going offline while
    /// another route home still exists, where the tail keeps arriving at the
    /// delay it was sent under. This is the case that suite names as outside
    /// itself: destruction, where there is no onward route and the samples that
    /// had not yet crossed the dead relay can never arrive at all.
    ///
    /// <para>That case used to be undeliverable-in-principle and delivered
    /// anyway. The route's per-hop geometry is summed into one scalar by
    /// <c>SignalDelay.Compute</c>, so nothing downstream could say WHERE the
    /// break sat, and a record-time delay stamp fixes when a sample arrives
    /// rather than whether. The drop event is what carries the position, and
    /// this is the whole chain it travels: a main-thread observation, the tick
    /// job, <c>INetwork.DropPath</c>, the Courier declining the delivery, and a
    /// socket that stays quiet.</para>
    /// </summary>
    public class MiddlemanDestructionTests
    {
        private static readonly TimeSpan Timeout = TimeSpan.FromSeconds(10);
        private static readonly TimeSpan Quiet = TimeSpan.FromMilliseconds(500);

        private const string Topic = ConnectivityHorizonTestUplink.DelayedTopic;

        /// <summary>
        /// Five samples over a 4 s path, then at UT 6 a relay
        /// <paramref name="breakOut"/> light-seconds out stops carrying and the
        /// craft is left with no route home. Returns, per tick from UT 6 to
        /// UT 14, the ValidAts that landed on that tick.
        /// </summary>
        private static async Task<Dictionary<double, List<double>>> RunDestructionAsync(double breakOut)
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new ConnectivityHorizonTestUplink());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, Topic, Timeout);

                engine.TickAndWait(0.0, ConnectivityHorizonTestUplink.Snapshot(0.0, connected: true, delay: 4.0), Timeout);
                foreach (var ut in new[] { 1.0, 2.0, 3.0, 4.0, 5.0 })
                {
                    engine.TickAndWait(ut, ConnectivityHorizonTestUplink.Snapshot(ut, connected: true, delay: 4.0, delayed: 10.0 + ut), Timeout);
                }

                // Only the UT 1 sample has arrived (1 + 4 = 5). Four are still
                // crossing the old path when the relay dies.
                var throughUt5 = await DrainAllStreamDataAsync(client, Quiet);
                Assert.Equal(
                    new[] { 1.0 },
                    throughUt5.Where(f => f.Topic == Topic).Select(f => f.Meta.ValidAt).ToArray());

                // THE DEATH, at UT 6. The craft loses its route home with it, so
                // it also goes disconnected and the reveal gate freezes
                // everything recorded from here: what is being watched is purely
                // the fate of the four already in flight.
                var byTick = new Dictionary<double, List<double>>();
                for (var ut = 6.0; ut <= 14.0; ut += 1.0)
                {
                    var snapshot = ut == 6.0
                        ? ConnectivityHorizonTestUplink.Snapshot(ut, connected: false, delay: 4.0, delayed: 10.0 + ut, breakOut: breakOut)
                        : ConnectivityHorizonTestUplink.Snapshot(ut, connected: false, delay: 4.0, delayed: 10.0 + ut);
                    engine.TickAndWait(ut, snapshot, Timeout);
                    var frames = await DrainAllStreamDataAsync(client, Quiet);
                    byTick[ut] = frames.Where(f => f.Topic == Topic).Select(f => f.Meta.ValidAt).ToList();
                }
                return byTick;
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// A relay TWO light-seconds along a four-second path dies at UT 6. The
        /// tail splits where it physically has to: the samples stamped UT 2, 3
        /// and 4 were already past that relay (2 + 2, 3 + 2, 4 + 2 all at or
        /// before 6) and keep arriving on their own timing, and the UT 5 sample,
        /// which would not have reached it until UT 7, never arrives at all.
        ///
        /// <para>The stream then stays quiet rather than resuming, because there
        /// is nothing behind the tail: the craft has no route home. Before the
        /// drop event the UT 5 sample landed at UT 9 like the rest, having
        /// crossed a relay that was no longer there.</para>
        /// </summary>
        [Fact]
        public async Task TheTailIsDeliveredUpToTheDeadRelayAndNoFurther()
        {
            var byTick = await RunDestructionAsync(breakOut: 2.0);

            Assert.Equal(new[] { 2.0 }, byTick[6.0]);
            Assert.Equal(new[] { 3.0 }, byTick[7.0]);
            Assert.Equal(new[] { 4.0 }, byTick[8.0]);

            // The one that had not crossed. Its delivery was scheduled, fired,
            // and declined.
            Assert.Empty(byTick[9.0]);

            foreach (var ut in new[] { 10.0, 11.0, 12.0, 13.0, 14.0 })
            {
                Assert.Empty(byTick[ut]);
            }
        }

        /// <summary>
        /// The same death, the same instant, the same five samples, with the
        /// break FURTHER along the route: four light-seconds out instead of two.
        /// More of the tail is short of it, so more of the tail is lost. Only
        /// the sample stamped UT 2 survives, having completed the whole
        /// four-second crossing at the very instant the break opened, and UT 3,
        /// 4 and 5 are all retired where the previous test delivered them.
        ///
        /// <para>Paired with the test above deliberately, and this pair is the
        /// argument for the whole design. One fixture, one difference, opposite
        /// answers for three of the five samples: a break is not a flag that
        /// telemetry stopped, it is a POSITION, and a model that only knew a
        /// relay had died could not choose between these two outcomes.</para>
        /// </summary>
        [Fact]
        public async Task ABreakFurtherAlongTheRouteTakesMoreOfTheTail()
        {
            var byTick = await RunDestructionAsync(breakOut: 4.0);

            Assert.Equal(new[] { 2.0 }, byTick[6.0]);

            foreach (var ut in new[] { 7.0, 8.0, 9.0, 10.0, 11.0, 12.0, 13.0, 14.0 })
            {
                Assert.Empty(byTick[ut]);
            }
        }
    }
}
