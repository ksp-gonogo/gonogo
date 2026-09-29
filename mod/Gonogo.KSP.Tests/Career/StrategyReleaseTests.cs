using System;
using Gonogo.KSP.Career;
using Sitrep.Contract;
using Xunit;

namespace Gonogo.KSP.Tests.Career
{
    /// <summary>
    /// Ending a strategy is answered by whether the strategy is still active,
    /// because RP-1's leader removal charges reputation and clears the strategy
    /// before a tail of bookkeeping that can throw.
    /// </summary>
    public class StrategyReleaseTests
    {
        [Fact]
        public void AThrowAfterTheStrategyWasReleasedIsARelease()
        {
            var strategy = new FakeStrategy { ReleaseThenThrow = true };
            Exception? heard = null;

            var result = StrategyRelease.Deactivate(strategy, ex => heard = ex);

            Assert.True(result.Success);
            Assert.False(strategy.IsActive);
            Assert.IsType<NullReferenceException>(heard);
        }

        /// <summary>A throw before anything changed stays a throw, so the engine still takes the command down.</summary>
        [Fact]
        public void AThrowWithTheStrategyStillActivePropagates()
        {
            var strategy = new FakeStrategy { ThrowBeforeRelease = true };
            Exception? heard = null;

            Assert.Throws<NullReferenceException>(() => StrategyRelease.Deactivate(strategy, ex => heard = ex));
            Assert.True(strategy.IsActive);
            Assert.Null(heard);
        }

        [Fact]
        public void AReleaseThatReturnsIsOk()
        {
            var strategy = new FakeStrategy();

            var result = StrategyRelease.Deactivate(strategy, _ => { });

            Assert.True(result.Success);
            Assert.False(strategy.IsActive);
        }

        [Fact]
        public void ADeclinedReleaseIsWrongState()
        {
            var strategy = new FakeStrategy { Declines = true };

            var result = StrategyRelease.Deactivate(strategy, _ => { });

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.WrongState, result.ErrorCode);
            Assert.True(strategy.IsActive);
        }

        private sealed class FakeStrategy : IStrategyReleaseTarget
        {
            public bool ReleaseThenThrow { get; set; }

            public bool ThrowBeforeRelease { get; set; }

            public bool Declines { get; set; }

            public bool IsActive { get; private set; } = true;

            public bool Deactivate()
            {
                if (ThrowBeforeRelease) throw new NullReferenceException();
                if (Declines) return false;
                IsActive = false;
                if (ReleaseThenThrow) throw new NullReferenceException();
                return true;
            }
        }
    }
}
