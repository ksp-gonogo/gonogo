using System.Linq;
using Sitrep.Host;
using Xunit;

namespace Sitrep.Host.Tests
{
    public class ReferenceIdRegistryBoundTests
    {
        [Fact]
        public void AnInstanceUsedEachSampleKeepsItsIdWhileManyOthersComeAndGo()
        {
            var registry = new ReferenceIdRegistry<object>();
            var live = new object();
            var id = registry.GetOrAssign(live);

            for (var i = 0; i < ReferenceIdRegistry<object>.Capacity * 4; i++)
            {
                registry.GetOrAssign(new object());
                registry.GetOrAssign(live);
            }

            Assert.Equal(id, registry.GetOrAssign(live));
        }

        [Fact]
        public void AnInstanceNotSeenSinceMoreThanCapacityOthersIsForgotten()
        {
            var registry = new ReferenceIdRegistry<object>();
            var gone = new object();
            var id = registry.GetOrAssign(gone);

            foreach (var other in Enumerable.Range(0, ReferenceIdRegistry<object>.Capacity).Select(_ => new object()))
            {
                registry.GetOrAssign(other);
            }

            Assert.False(registry.TryResolve(id, new[] { gone }, out _));
        }
    }
}
