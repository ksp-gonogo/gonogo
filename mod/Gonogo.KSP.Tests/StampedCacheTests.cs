using Xunit;

namespace Gonogo.KSP.Tests
{
    public class StampedCacheTests
    {
        [Fact]
        public void AResultIsKeptWhileItsStampIsUnchanged()
        {
            var cache = new StampedCache<string>();
            cache.Put("a.craft", 10, "parsed");

            Assert.True(cache.TryGet("a.craft", 10, out var hit));
            Assert.Equal("parsed", hit);
            Assert.False(cache.TryGet("a.craft", 11, out _));
            Assert.False(cache.TryGet("b.craft", 10, out _));
        }

        [Fact]
        public void ANullResultIsKeptToo_SoACraftThatCannotBeReadIsNotReadAgain()
        {
            var cache = new StampedCache<string?>();
            cache.Put("broken.craft", 5, null);

            Assert.True(cache.TryGet("broken.craft", 5, out var hit));
            Assert.Null(hit);
            Assert.False(cache.TryGet("broken.craft", 6, out _));
        }

        [Fact]
        public void AKeyNotAskedForSinceTheLastSweepIsForgotten()
        {
            var cache = new StampedCache<string>();
            cache.Put("kept.craft", 1, "a");
            cache.Put("deleted.craft", 1, "b");
            cache.ForgetUnseen();

            cache.TryGet("kept.craft", 1, out _);
            cache.ForgetUnseen();

            Assert.True(cache.TryGet("kept.craft", 1, out _));
            Assert.False(cache.TryGet("deleted.craft", 1, out _));
        }
    }
}
