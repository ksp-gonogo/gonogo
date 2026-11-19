using System.Collections.Generic;
using System.Linq;
using Sitrep.Host;
using Xunit;

namespace Sitrep.Host.Tests
{
    public class PartWindowFreshTests
    {
        private static List<(string Id, bool Publish)> Take(PartWindowFresh f, long budget = 1000, long perRead = 0)
        {
            long now = 0;
            return f.Take(() => now += perRead, budget, _ => true);
        }

        [Fact]
        public void AWindowIsReadSilentlyFirstAndPublishedOnItsSecondRead()
        {
            var f = new PartWindowFresh();
            f.Add("a");

            var first = Take(f);
            var second = Take(f);
            var third = Take(f);

            Assert.Equal(new[] { ("a", false) }, first);
            Assert.Equal(new[] { ("a", true) }, second);
            Assert.Empty(third);
            Assert.False(f.Pending);
        }

        [Fact]
        public void AnIdQueuedTwiceIsReadOnceInEachStep()
        {
            var f = new PartWindowFresh();
            f.Add("a");
            f.Add("a");

            Assert.Single(Take(f));
            Assert.Single(Take(f));
            Assert.Empty(Take(f));
        }

        [Fact]
        public void SecondReadsGoBeforeNewFirstReadsAndAWindowAddedLaterWaitsItsTurn()
        {
            var f = new PartWindowFresh();
            f.Add("a");
            Take(f);
            f.Add("b");

            var reads = Take(f);

            Assert.Equal(new[] { ("a", true), ("b", false) }, reads);
        }

        [Fact]
        public void TheBudgetStopsTheReadsAndTheRestWaitWithAtLeastOneRead()
        {
            var f = new PartWindowFresh();
            for (var i = 0; i < 10; i++) f.Add("p" + i);

            // Each read costs 1 ms and the budget is 4 ms.
            var reads = Take(f, budget: 4, perRead: 1);

            Assert.Equal(4, reads.Count);
            Assert.True(f.Pending);

            // The four read before are second-read first, then new ones, until the budget is gone again.
            var next = Take(f, budget: 4, perRead: 1);
            Assert.True(next.First().Publish);
        }

        [Fact]
        public void AWindowIsNotReadUntilTheMirrorHoldsItAndIsDroppedIfItNeverDoes()
        {
            var f = new PartWindowFresh();
            f.Add("a");
            var ready = false;
            long now = 0;

            Assert.Empty(f.Take(() => now, 1000, _ => ready));
            Assert.True(f.Pending);

            ready = true;
            Assert.Equal(new[] { ("a", false) }, f.Take(() => now, 1000, _ => ready));

            var never = new PartWindowFresh();
            never.Add("b");
            for (var i = 0; i < 30; i++) never.Take(() => now, 1000, _ => false);
            Assert.False(never.Pending);
        }
    }
}
