using Xunit;

namespace Sitrep.Contract.Tests
{
    public class CommsNodeHandleTests
    {
        private sealed class Node
        {
        }

        [Fact]
        public void NoNodeIsNoHandle()
        {
            Assert.Null(CommsNodeHandle.Of(null));
        }

        [Fact]
        public void TwoWrapsOfOneNodeAreTheSameNode()
        {
            var node = new Node();
            var a = CommsNodeHandle.Of(node);
            var b = CommsNodeHandle.Of(node);

            Assert.NotSame(a, b);
            Assert.True(a == b);
            Assert.False(a != b);
            Assert.Equal(a, b);
            Assert.Equal(a!.GetHashCode(), b!.GetHashCode());
        }

        [Fact]
        public void TwoNodesAreDifferentEvenWhenTheyCompareEqualThemselves()
        {
            var a = CommsNodeHandle.Of("relay");
            var b = CommsNodeHandle.Of(new string("relay".ToCharArray()));

            Assert.True(a != b);
            Assert.NotEqual(a, b);
        }

        [Fact]
        public void TwoAbsentNodesCompareEqualAndAnAbsentOneMatchesNothing()
        {
            CommsNodeHandle? none = null;

            Assert.True(none == null);
            Assert.False(CommsNodeHandle.Of(new Node()) == none);
            Assert.False(CommsNodeHandle.Of(new Node())!.Equals(none));
        }

        [Fact]
        public void ANodeReadsBackAsItsOwnTypeAndAsNoOther()
        {
            var node = new Node();
            var handle = CommsNodeHandle.Of(node)!;

            Assert.Same(node, handle.As<Node>());
            Assert.Same(node, handle.As<object>());
            Assert.Null(handle.As<string>());
        }
    }
}
