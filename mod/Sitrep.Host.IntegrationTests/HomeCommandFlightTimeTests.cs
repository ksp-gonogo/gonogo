using System;
using System.Threading;
using Sitrep.Host;
using Xunit;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// A command addressed to the home command's ledger, the shape every career
    /// command has, dispatched from a vessel vantage rather than from the ground.
    ///
    /// <para>The command names a held-at-home topic as its subject, so the node
    /// it resolves to is the ledger's, and its flight time is the vantage's row
    /// against that node. The active craft is kept at a light-time far from the
    /// vessel's own, so a command timed by the wrong node lands at the wrong
    /// tick.</para>
    /// </summary>
    public class HomeCommandFlightTimeTests
    {
        private static readonly TimeSpan Timeout = TestBudgets.Op;

        private const string Vessel = "vessel:G";
        private const double ActiveVesselDelay = 240.0;

        /// <summary>
        /// Executes at home one leg after dispatch, and the result comes back one
        /// more leg later. The flight time the dispatching client is told is the
        /// same leg, which is what its loss deadline reads.
        /// </summary>
        [Fact]
        public void ACareerCommandFromAVesselExecutesAtHomeOneLegOutAndConfirmsOneLegBack()
        {
            const double up = 3.0;

            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            var uplink = new HomeSpendTestUplink();
            engine.RegisterUplink(uplink);
            engine.Start();
            try
            {
                engine.SetHomeCommandDelay(Vessel, up);
                engine.TickAndWait(0.0, HomeLedgerTestUplink.Snapshot(0.0, ledger: 10.0, delay: ActiveVesselDelay), Timeout);

                var resolved = 0;
                double? flightTime = null;
                string? refused = null;
                engine.DispatchCommandAndWait(
                    HomeSpendTestUplink.Command,
                    "funds",
                    Vessel,
                    _ => Interlocked.Increment(ref resolved),
                    TestBudgets.Op,
                    onRefused: reason => refused = reason,
                    onAccepted: seconds => flightTime = seconds);

                Assert.True(refused == null, refused);
                Assert.Equal(up, flightTime);
                Assert.Equal(up, engine.LedgerDelayFor(Vessel, ChannelEngine.HomeCommandNode));

                Tick(engine, up - 0.5);
                Assert.Equal(0, uplink.HandledCount);

                Tick(engine, up);
                Assert.Equal(1, uplink.HandledCount);
                Assert.Equal(0, Volatile.Read(ref resolved));

                Tick(engine, 2 * up - 0.5);
                Assert.Equal(0, Volatile.Read(ref resolved));

                Tick(engine, 2 * up);
                Assert.Equal(1, Volatile.Read(ref resolved));
            }
            finally
            {
                engine.Stop();
            }
        }

        private static void Tick(ChannelEngine engine, double ut) =>
            engine.TickAndWait(ut, HomeLedgerTestUplink.Snapshot(ut, ledger: 10.0, delay: ActiveVesselDelay), Timeout);
    }
}
