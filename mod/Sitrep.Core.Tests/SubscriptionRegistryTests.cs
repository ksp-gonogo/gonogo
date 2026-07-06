using Xunit;
using Sitrep.Core;

namespace Sitrep.Core.Tests
{
    /// <summary>
    /// C#-only tests for <see cref="SubscriptionRegistry"/> (streaming-slice-1
    /// Track A) -- no TS reference, no golden fixture. See
    /// <see cref="ChannelEmitterTests.UnsubscribedChannelNeverReachesDecideAndEmitsNothing"/>
    /// for the composed outer/inner gate proof against <see cref="ChannelEmitter"/>.
    /// </summary>
    public class SubscriptionRegistryTests
    {
        [Fact]
        public void SubscribeReturnsTrueOnlyOnZeroToOneTransition()
        {
            var registry = new SubscriptionRegistry();

            Assert.False(registry.IsSubscribed("v.altitude"));
            Assert.True(registry.Subscribe("v.altitude")); // 0 -> 1
            Assert.False(registry.Subscribe("v.altitude")); // 1 -> 2
            Assert.False(registry.Subscribe("v.altitude")); // 2 -> 3

            Assert.True(registry.IsSubscribed("v.altitude"));
            Assert.Equal(3, registry.SubscriberCount("v.altitude"));
        }

        [Fact]
        public void UnsubscribeReturnsTrueOnlyOnOneToZeroTransition()
        {
            var registry = new SubscriptionRegistry();
            registry.Subscribe("v.altitude");
            registry.Subscribe("v.altitude");

            Assert.False(registry.Unsubscribe("v.altitude")); // 2 -> 1
            Assert.True(registry.IsSubscribed("v.altitude"));

            Assert.True(registry.Unsubscribe("v.altitude")); // 1 -> 0
            Assert.False(registry.IsSubscribed("v.altitude"));
            Assert.Equal(0, registry.SubscriberCount("v.altitude"));
        }

        [Fact]
        public void UnsubscribingAnUnknownOrAlreadyEmptyChannelIsANoOp()
        {
            var registry = new SubscriptionRegistry();
            Assert.False(registry.Unsubscribe("v.never-subscribed"));

            registry.Subscribe("v.altitude");
            registry.Unsubscribe("v.altitude");
            Assert.False(registry.Unsubscribe("v.altitude")); // already at 0
        }

        [Fact]
        public void ResubscribingAfterFullyUnsubscribingIsANewZeroToOneTransition()
        {
            var registry = new SubscriptionRegistry();
            registry.Subscribe("v.altitude");
            registry.Unsubscribe("v.altitude");

            Assert.False(registry.IsSubscribed("v.altitude"));
            Assert.True(registry.Subscribe("v.altitude")); // 0 -> 1 again
        }
    }
}
