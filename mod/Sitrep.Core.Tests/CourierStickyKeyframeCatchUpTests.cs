using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Core;
using Xunit;

namespace Sitrep.Core.Tests
{
    /// <summary>
    /// <see cref="Courier.SubscribeStream"/>'s sticky-keyframe catch-up
    /// (<see cref="Courier.Record"/>'s <c>isKeyframe</c> parameter): a
    /// subscriber joining a <see cref="Delivery.ReliableOrdered"/> topic
    /// AFTER a keyframe and some diffs have already been recorded must catch
    /// up on the sticky keyframe, never on the bare trailing diff, which has
    /// no baseline a brand-new subscriber could apply it to.
    /// </summary>
    public class CourierStickyKeyframeCatchUpTests
    {
        private const string Node = "vessel-1";
        private const string Topic = "diff.stream";

        [Fact]
        public void LateSubscriberAfterDiffsHaveFlowed_CatchesUpOnStickyKeyframe_NotTheTrailingDiff()
        {
            var clock = new ManualClock();
            var network = new StubNetwork(); // delay 0
            var courier = new Courier(clock, network);

            courier.Record(Node, Topic, "base", validAtUt: 0, delivery: Delivery.ReliableOrdered, isKeyframe: true);
            courier.Record(Node, Topic, "diff-1", validAtUt: 0, delivery: Delivery.ReliableOrdered, isKeyframe: false);
            courier.Record(Node, Topic, "diff-2", validAtUt: 0, delivery: Delivery.ReliableOrdered, isKeyframe: false);

            var received = new List<object?>();
            courier.SubscribeStream(Node, Topic, "late-viewer", data => received.Add(data.Payload));

            Assert.Equal("base", Assert.Single(received));

            // Chains cleanly onto live diffs: a new frame recorded after the
            // late subscribe still reaches it, on top of the sticky baseline.
            courier.Record(Node, Topic, "diff-3", validAtUt: 1, delivery: Delivery.ReliableOrdered, isKeyframe: false);
            clock.AdvanceTo(1);

            Assert.Equal(new List<object?> { "base", "diff-3" }, received);
        }
    }
}
