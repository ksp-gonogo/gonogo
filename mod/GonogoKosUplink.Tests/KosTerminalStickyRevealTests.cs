using System.Collections.Generic;
using Gonogo.KosUplink;
using Sitrep.Contract;
using Sitrep.Core;
using Xunit;

namespace GonogoKosUplink.Tests
{
    /// <summary>
    /// Regression for the kOS terminal "black screen for one signal-delay
    /// after a CPU button press" bug
    /// (local_docs/kos-terminal-feedback-2026-07-15.md, "Loading /
    /// connection" section). Wires a REAL <see cref="Courier"/> as the
    /// <see cref="KosTerminalManager"/>'s publish sink — same pattern as
    /// <see cref="KosTerminalCourierBurstTests"/> — so the real
    /// <see cref="KosTerminalFrame.FullRepaint"/> flag produced by
    /// <c>KosTerminalManager.Poll</c>'s own forced-reseed logic drives the
    /// engine's sticky-keyframe cache (<c>Courier.Record</c>'s
    /// <c>isKeyframe</c> parameter — see <c>KosExtension.Ksp.cs</c>'s
    /// <c>IsKeyframe</c> wiring, which does exactly the
    /// <c>frame.FullRepaint</c> check this test performs inline since the
    /// KSP-bound half of <c>Gonogo.KosUplink</c> cannot be compiled in this
    /// project — see this project's own header comment on why
    /// <c>KosExtension.Ksp.cs</c> isn't in its Compile list).
    ///
    /// <para>The scenario: an operator watches a CPU's terminal (a
    /// full-repaint reseed followed by incremental diffs — ordinary kOS
    /// output), then looks away. A SECOND viewer (a station watching the
    /// same CPU, or the same operator switching back after looking at a
    /// different CPU tab) subscribes AFTER that history already exists. The
    /// synchronous catch-up they receive must be the sticky FULL REPAINT,
    /// never the bare trailing diff that happens to be the "latest recorded
    /// sample" — a diff has no baseline for a brand-new subscriber to apply
    /// it to.</para>
    /// </summary>
    public class KosTerminalStickyRevealTests
    {
        private sealed class QueuedFakeScreen : IKosTerminalScreen
        {
            private readonly Queue<string> _outputs;

            public QueuedFakeScreen(Queue<string> outputs)
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
        public void Poll_LateSubscriberAfterDiffsHaveFlowed_CatchesUpOnStickyFullRepaint_NotABareTrailingDiff()
        {
            var clock = new ManualClock(startUt: 1000);
            var network = new StubNetwork(delay: 0);
            var courier = new Courier(clock, network);

            const string node = "vessel-1";
            const int coreId = 7;
            var topic = KosChannels.TerminalTopic(coreId);

            var outputs = new Queue<string>(new[] { "BOOT>", "BOOT> RUN", "BOOT> RUN PROG.KS" });

            // Publish sink mirrors KosExtension.Ksp.cs's real wiring:
            // Delivery.ReliableOrdered (a dropped frame corrupts the diff
            // stream) + isKeyframe sourced from FullRepaint (the same check
            // the real ChannelDeclaration.IsKeyframe predicate performs).
            var manager = new KosTerminalManager(
                knownCoreIds: () => new[] { coreId },
                isSubscribed: id => true,
                publish: (id, frame, ut) => courier.Record(
                    node, topic, frame, ut, Delivery.ReliableOrdered,
                    isKeyframe: frame.FullRepaint),
                createScreen: id => new QueuedFakeScreen(outputs),
                nowUt: () => clock.Now());

            // Three ~20Hz polls, clock deliberately unadvanced between them
            // (matches KosTerminalCourierBurstTests's rationale — the poll
            // cadence outruns the Courier clock's own cadence). Poll #1
            // creates the session -> forced reseed ("BOOT>", FullRepaint
            // true). Polls #2/#3 are ordinary diffs (FullRepaint false) --
            // the keyframe interval (default 1.0s) hasn't elapsed since the
            // clock never moved.
            manager.Poll(1.0);
            manager.Poll(1.0);
            manager.Poll(1.0);

            // A viewer who was watching from the start would have seen all
            // three frames in order (KosTerminalCourierBurstTests already
            // covers that). This test is about a viewer who was NOT
            // watching and subscribes only NOW, after all three are already
            // recorded.
            var received = new List<KosTerminalFrame>();
            courier.SubscribeStream(node, topic, "late-viewer", data =>
            {
                if (data.Payload is KosTerminalFrame frame)
                {
                    received.Add(frame);
                }
            });

            Assert.NotEmpty(received);
            var catchUp = received[0];
            Assert.True(catchUp.FullRepaint, "late subscriber's catch-up must be the sticky full repaint, not a bare trailing diff");
            Assert.Equal("BOOT>", catchUp.Chunk);

            // Chains cleanly onto live diffs: a NEW frame recorded after the
            // late subscribe must still reach it, in order, on top of the
            // sticky baseline it already has.
            courier.Record(node, topic, new KosTerminalFrame { CoreId = coreId, Chunk = "BOOT> RUN PROG.KS OK", FullRepaint = false }, clock.Now(), Delivery.ReliableOrdered, isKeyframe: false);
            clock.AdvanceTo(clock.Now() + 1);

            Assert.Contains(received, f => f.Chunk == "BOOT> RUN PROG.KS OK" && !f.FullRepaint);
        }
    }
}
