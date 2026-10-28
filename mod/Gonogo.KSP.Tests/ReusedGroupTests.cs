using System.Collections.Generic;
using Gonogo.KSP;
using Xunit;

namespace Gonogo.KSP.Tests
{
    public class ReusedGroupTests
    {
        private static readonly object Save = new object();

        private static ReusedGroup<Dictionary<string, object?>> Kept(out Dictionary<string, object?> group)
        {
            group = new Dictionary<string, object?> { ["balances"] = 1.0 };
            var kept = new ReusedGroup<Dictionary<string, object?>>();
            kept.Keep(group, ut: 100, wallSeconds: 50, epoch: 3, signature: "2|k|90", save: Save);
            return kept;
        }

        [Fact]
        public void TheSameGroupIsHandedOnWhileNothingItIsReadFromHasMoved()
        {
            var kept = Kept(out var group);

            Assert.True(kept.TryReuse(104.9, 54.9, 3, "2|k|90", Save, fullSample: false, out var again));
            Assert.Same(group, again);
        }

        [Fact]
        public void AnEventASettledObjectiveOrAnotherSaveBuildsItAgain()
        {
            var kept = Kept(out _);

            Assert.False(kept.TryReuse(101, 51, 4, "2|k|90", Save, false, out _));
            Assert.False(kept.TryReuse(101, 51, 3, "3|m|101", Save, false, out _));
            Assert.False(kept.TryReuse(101, 51, 3, "2|k|90", new object(), false, out _));
        }

        [Fact]
        public void ItIsNeverKeptPastTheMaximumAgeInGameOrRealTime()
        {
            var kept = Kept(out _);

            Assert.False(kept.TryReuse(100 + ReusedGroup<object>.MaxAgeSeconds, 51, 3, "2|k|90", Save, false, out _));
            Assert.False(kept.TryReuse(101, 50 + ReusedGroup<object>.MaxAgeSeconds, 3, "2|k|90", Save, false, out _));
        }

        [Fact]
        public void ARewindOrASampleThatBuildsEverythingBuildsItAgain()
        {
            var kept = Kept(out _);

            Assert.False(kept.TryReuse(99, 51, 3, "2|k|90", Save, false, out _));
            Assert.False(kept.TryReuse(101, 51, 3, "2|k|90", Save, fullSample: true, out _));
        }

        [Fact]
        public void NothingIsKeptFromAnEmptyBuild()
        {
            var kept = new ReusedGroup<Dictionary<string, object?>>();
            kept.Keep(null, 100, 50, 3, "", Save);

            Assert.False(kept.TryReuse(101, 51, 3, "", Save, false, out _));
        }
    }
}
