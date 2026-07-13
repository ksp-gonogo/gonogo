using System.Collections.Generic;
using Gonogo.Kos;
using Sitrep.Contract;
using Sitrep.Core;
using Xunit;

namespace Gonogo.Kos.Tests
{
    /// <summary>
    /// Regression for kOS terminal-garble: the
    /// <c>kos.terminal.&lt;coreId&gt;</c> downlink is a cursor-relative DIFF
    /// stream. It rides the shared Courier/Archive delay engine, whose STATE
    /// (<see cref="Delivery.LossyLatest"/>) lane models a topic as "latest
    /// sample as of the light-lagged scene" (<see cref="Archive.ReadAtVantage"/>)
    /// — correct for state topics, but fatal for a diff stream: a burst of
    /// terminal frames published within a single Courier clock tick (several
    /// <see cref="KosTerminalManager.Poll"/> calls at ~20Hz on the main thread,
    /// all reading the SAME unadvanced UT source) stamps them with an identical
    /// <c>ValidAt</c>, and the re-read lane would coalesce them to the latest.
    ///
    /// The terminal is therefore declared <see cref="Delivery.ReliableOrdered"/>
    /// (see <c>KosExtension.Ksp.cs</c>), whose lane FORWARDS each recorded
    /// sample in order — so a same-<c>ValidAt</c> burst delivers every frame,
    /// no strictly-increasing stamp needed. This wires a REAL
    /// <see cref="Courier"/> + <see cref="Archive"/> (via
    /// <see cref="Courier.SubscribeStream"/>/<see cref="Courier.Record"/>) as
    /// the <see cref="KosTerminalManager"/>'s publish sink — exactly the
    /// terminal publish path production wires — so the proof exercises the real
    /// mechanism, not a synthetic stand-in.
    /// </summary>
    public class KosTerminalCourierBurstTests
    {
        private sealed class BurstFakeScreen : IKosTerminalScreen
        {
            private readonly Queue<string> _outputs;

            public BurstFakeScreen(Queue<string> outputs)
            {
                _outputs = outputs;
            }

            public TerminalReadResult ReadChunk(bool forceReseed) =>
                _outputs.Count > 0
                    ? TerminalReadResult.Output(_outputs.Dequeue(), forceReseed)
                    : TerminalReadResult.None;

            public bool TypeChars(string chars) => true;

            public void Resize(int cols, int rows)
            {
            }
        }

        [Fact]
        public void Poll_BurstWithinSingleClockTick_AllFramesDeliveredInOrder_NoneDroppedOrDuplicated()
        {
            var clock = new ManualClock(startUt: 1000);
            var network = new StubNetwork(delay: 0);
            var courier = new Courier(clock, network);

            const string node = "vessel-1";
            const string vantage = "KSC";
            const int coreId = 7;
            var topic = KosChannels.TerminalTopic(coreId);

            var received = new List<string>();
            courier.SubscribeStream(node, topic, vantage, data =>
            {
                if (data.Payload is KosTerminalFrame frame)
                {
                    received.Add(frame.Chunk);
                }
            });

            var outputs = new Queue<string>(new[] { "chunk-1", "chunk-2", "chunk-3" });

            // The Courier clock is deliberately never advanced between polls
            // below — nowUt returns the SAME UT across the whole burst,
            // exactly the "the terminal's ~20Hz poll outruns the Courier
            // clock's own ~50ms cadence" scenario. The frames all share a
            // ValidAt; the Delivery.ReliableOrdered lane forwards each in
            // record order rather than re-reading the coalesced latest.
            var manager = new KosTerminalManager(
                knownCoreIds: () => new[] { coreId },
                isSubscribed: id => true,
                publish: (id, frame, ut) => courier.Record(node, topic, frame, ut, Delivery.ReliableOrdered),
                createScreen: id => new BurstFakeScreen(outputs),
                nowUt: () => clock.Now(),
                pollIntervalSeconds: 0.05);

            // Three ~20Hz main-thread polls fire while the Courier clock
            // stays parked at the same UT (it only advances on its own
            // ~50ms cadence, decoupled from the terminal's poll cadence).
            manager.Poll(1.0);
            manager.Poll(1.0);
            manager.Poll(1.0);

            // Let every scheduled (zero-delay) delivery drain.
            clock.AdvanceTo(clock.Now() + 1);

            Assert.Equal(new[] { "chunk-1", "chunk-2", "chunk-3" }, received);
        }
    }
}
