using System.Collections.Generic;
using Gonogo.KSP;
using Xunit;

namespace Gonogo.KSP.Tests
{
    public class CraftReadCacheTests
    {
        private const string Path = "Ships/VAB/MkI.craft";
        private const long Version = 100;

        private static CraftRead Rows() => CraftRead.Of(new List<object?> { new object() });

        [Fact]
        public void ARetriedReadThatSucceedsWithTheFileUnchangedIsUsed()
        {
            var cache = new CraftReadCache(retrySeconds: 5);

            Assert.False(cache.TryGet(Path, Version, 0, out _));
            cache.Store(Path, Version, 0, CraftRead.Failed("no PART nodes"));
            Assert.False(cache.TryGet(Path, Version, 5, out _));

            cache.Store(Path, Version, 5, Rows());

            Assert.True(cache.TryGet(Path, Version, 6, out var read));
            Assert.NotNull(read.Rows);
        }

        [Fact]
        public void AFailedReadIsNotReadAgainBeforeItsRetryTime()
        {
            var cache = new CraftReadCache(retrySeconds: 5);
            cache.Store(Path, Version, 0, CraftRead.Failed("no PART nodes"));

            Assert.True(cache.TryGet(Path, Version, 4.9, out var read));
            Assert.Null(read.Rows);
        }

        [Fact]
        public void AReadThatGaveRowsIsReusedWhileTheFileIsUnchanged()
        {
            var cache = new CraftReadCache(retrySeconds: 5);
            cache.Store(Path, Version, 0, Rows());

            Assert.True(cache.TryGet(Path, Version, 600, out var read));
            Assert.NotNull(read.Rows);
            Assert.False(cache.TryGet(Path, Version + 1, 600, out _));
        }

        [Fact]
        public void AFailureIsReportedOnceWhileItsReasonStaysTheSame()
        {
            var cache = new CraftReadCache(retrySeconds: 5);

            Assert.True(cache.Store(Path, Version, 0, CraftRead.Failed("no PART nodes")));
            Assert.False(cache.Store(Path, Version, 5, CraftRead.Failed("no PART nodes")));
            Assert.True(cache.Store(Path, Version, 10, CraftRead.Failed("no known part")));
        }

        [Fact]
        public void AFailureIsReportedAgainForANewVersionOfTheFile()
        {
            var cache = new CraftReadCache(retrySeconds: 5);
            cache.Store(Path, Version, 0, CraftRead.Failed("no PART nodes"));

            Assert.True(cache.Store(Path, Version + 1, 1, CraftRead.Failed("no PART nodes")));
        }

        [Fact]
        public void ASuccessIsNeverReportedAsAFailure()
        {
            var cache = new CraftReadCache(retrySeconds: 5);

            Assert.False(cache.Store(Path, Version, 0, Rows()));
        }

        [Fact]
        public void ClearForgetsEveryRead()
        {
            var cache = new CraftReadCache(retrySeconds: 5);
            cache.Store(Path, Version, 0, Rows());
            cache.Clear();

            Assert.False(cache.TryGet(Path, Version, 0, out _));
        }
    }
}
