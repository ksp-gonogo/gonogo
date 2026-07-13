using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Core;
using Xunit;

// See Sitrep.Core/Courier.cs for why this alias exists.
using StreamData = Sitrep.Contract.StreamData<object?>;

namespace Sitrep.Core.Tests
{
    /// <summary>
    /// C#-side tests for <see cref="Courier.Record"/>'s per-channel delivery
    /// LANE — a C#-ONLY capability (no TS reference / golden fixture, same
    /// rationale as <see cref="CourierTimelineResetTests"/>).
    ///
    /// <para><see cref="Delivery.ReliableOrdered"/> (the kOS terminal's
    /// cursor-relative ordered-diff stream) must forward every recorded sample
    /// exactly once, in record order, even when a burst shares a single
    /// <c>ValidAt</c> — the shape the ~20Hz terminal poll produces within one
    /// Courier tick. <see cref="Delivery.LossyLatest"/> (every state topic —
    /// orbit, resources, comms) must keep the exact historical re-read
    /// behaviour: each scheduled delivery resolves the LATEST sample as of its
    /// vantage scene, coalescing a same-<c>ValidAt</c> burst to the final
    /// value. This pins the "reclassify" fix: the shared <see cref="Courier"/>
    /// delivery change is gated on the channel's declared <see cref="Delivery"/>
    /// so state topics are untouched.</para>
    /// </summary>
    public class CourierReliableOrderedDeliveryTests
    {
        private const string Node = "vessel-1";
        private const string Vantage = "KSC";

        [Fact]
        public void ReliableOrderedBurstAtOneValidAtDeliversEveryFrameInRecordOrder()
        {
            var clock = new ManualClock();
            var network = new StubNetwork(); // delay 0
            var courier = new Courier(clock, network);

            var delivered = new List<object?>();
            courier.SubscribeStream(Node, "kos.terminal.7", Vantage, data => delivered.Add(data.Payload));

            // Three ordered-diff frames stamped at the SAME ValidAt — the
            // same-tick collision the terminal poll produces. A re-read lane
            // coalesces these to the latest ("chunk-3" x3); the ReliableOrdered
            // lane must forward all three, in order.
            courier.Record(Node, "kos.terminal.7", "chunk-1", 1000, Delivery.ReliableOrdered);
            courier.Record(Node, "kos.terminal.7", "chunk-2", 1000, Delivery.ReliableOrdered);
            courier.Record(Node, "kos.terminal.7", "chunk-3", 1000, Delivery.ReliableOrdered);

            clock.AdvanceTo(1000);

            Assert.Equal(new List<object?> { "chunk-1", "chunk-2", "chunk-3" }, delivered);
        }

        [Fact]
        public void ReliableOrderedForwardsEachSampleAtItsOwnDelayedFireUtInOrder()
        {
            var clock = new ManualClock();
            var network = new StubNetwork();
            network.SetDelay(Vantage, Node, 5); // one-way light-time delay
            var courier = new Courier(clock, network);

            var delivered = new List<(object? Value, double ValidAt, double DeliveredAt)>();
            courier.SubscribeStream(Node, "kos.terminal.7", Vantage,
                data => delivered.Add((data.Payload, data.Meta.ValidAt, data.Meta.DeliveredAt)));

            // A same-ValidAt burst still rides the delay: every frame is
            // revealed at validAt + delay = 105, unchanged from the re-read
            // lane's scheduling — only WHAT is forwarded differs.
            courier.Record(Node, "kos.terminal.7", "a", 100, Delivery.ReliableOrdered);
            courier.Record(Node, "kos.terminal.7", "b", 100, Delivery.ReliableOrdered);

            clock.AdvanceTo(104);
            Assert.Empty(delivered); // not yet revealed (105 > 104)

            clock.AdvanceTo(105);
            Assert.Equal(
                new List<(object?, double, double)> { ("a", 100.0, 105.0), ("b", 100.0, 105.0) },
                delivered);
        }

        [Fact]
        public void LossyLatestBurstAtOneValidAtStillCoalescesToTheLatestSample()
        {
            var clock = new ManualClock();
            var network = new StubNetwork();
            var courier = new Courier(clock, network);

            var delivered = new List<object?>();
            courier.SubscribeStream(Node, "bodies", Vantage, data => delivered.Add(data.Payload));

            // Default (LossyLatest) — the state-topic guardrail. Three samples
            // at one ValidAt schedule three re-read deliveries; each resolves
            // the latest ("s3"), so the burst coalesces exactly as before the
            // reclassify. Proves the shared Deliver change did NOT alter state
            // behaviour.
            courier.Record(Node, "bodies", "s1", 1000);
            courier.Record(Node, "bodies", "s2", 1000);
            courier.Record(Node, "bodies", "s3", 1000);

            clock.AdvanceTo(1000);

            Assert.Equal(new List<object?> { "s3", "s3", "s3" }, delivered);
        }

        [Fact]
        public void ReliableOrderedSampleAbandonedByARewindIsDroppedNotForwarded()
        {
            var clock = new ManualClock();
            var network = new StubNetwork();
            var courier = new Courier(clock, network);

            var delivered = new List<object?>();
            courier.SubscribeStream(Node, "kos.terminal.7", Vantage, data => delivered.Add(data.Payload));

            // Record an in-flight ordered frame, then advance past a peak so
            // its delivery is scheduled but not yet fired.
            courier.Record(Node, "kos.terminal.7", "pre", 0, Delivery.ReliableOrdered);
            clock.AdvanceTo(0);
            courier.Record(Node, "kos.terminal.7", "abandoned", 50, Delivery.ReliableOrdered);

            // Quickload before "abandoned" would have fired.
            courier.ResetTimeline(10);
            courier.Record(Node, "kos.terminal.7", "resumed", 10, Delivery.ReliableOrdered);
            clock.AdvanceTo(60);

            // "abandoned" belonged to the dropped timeline; its captured-sample
            // closure must never fire — same drop the re-read lane gives.
            Assert.Equal(new List<object?> { "pre", "resumed" }, delivered);
        }
    }
}
