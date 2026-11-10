using Gonogo.KSP;
using Xunit;

namespace Gonogo.KSP.Tests
{
    public class PrunedCacheTests
    {
        private sealed class Owner
        {
            public bool Destroyed;
        }

        [Fact]
        public void EntriesWhoseKeysAreGoneAreSweptAsTheCacheGrows()
        {
            var cache = new PrunedCache<Owner, int>(owner => owner.Destroyed);
            for (var i = 0; i < 10_000; i++)
            {
                cache.Set(new Owner { Destroyed = true }, i);
            }

            Assert.True(cache.Count <= 128, "held " + cache.Count);
        }

        [Fact]
        public void EntriesWhoseKeysLiveAreKept()
        {
            var cache = new PrunedCache<Owner, int>(owner => owner.Destroyed);
            var kept = new Owner();
            cache.Set(kept, 7);
            for (var i = 0; i < 1_000; i++)
            {
                cache.Set(new Owner { Destroyed = true }, i);
            }

            Assert.True(cache.TryGetValue(kept, out var value));
            Assert.Equal(7, value);
        }

        [Fact]
        public void KeysAreComparedByIdentity()
        {
            var cache = new PrunedCache<string, int>(_ => false);
            var a = new string('x', 3);
            var b = new string('x', 3);
            cache.Set(a, 1);

            Assert.False(cache.TryGetValue(b, out _));
        }
    }
}
