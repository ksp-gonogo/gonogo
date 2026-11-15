using System;
using System.Collections.Generic;
using Xunit;

namespace Sitrep.Core.Tests
{
    /// <summary>
    /// An advance that may be stopped part way leaves what it did not fire on
    /// the clock, in order, for the next advance, and always makes progress.
    /// </summary>
    public class ManualClockBoundedAdvanceTests
    {
        [Fact]
        public void AnAdvanceToldToStopLeavesTheRestDueAndTheNextAdvanceFiresItInOrder()
        {
            var clock = new ManualClock();
            var fired = new List<int>();
            for (var i = 1; i <= 5; i++)
            {
                var n = i;
                clock.Schedule(n, () => fired.Add(n));
            }

            var drained = clock.AdvanceTo(10.0, () => fired.Count < 2);

            Assert.False(drained);
            Assert.Equal(new[] { 1, 2 }, fired);
            Assert.Equal(10.0, clock.Now());
            Assert.Equal(3.0, clock.NextDueUt);

            clock.Schedule(2.5, () => fired.Add(25));
            Assert.True(clock.AdvanceTo(10.0, () => true));
            Assert.Equal(new[] { 1, 2, 25, 3, 4, 5 }, fired);
        }

        [Fact]
        public void EveryCallFiresAtLeastOneDueCallbackHoweverSmallItsAllowance()
        {
            var clock = new ManualClock();
            var fired = 0;
            for (var i = 1; i <= 4; i++)
            {
                clock.Schedule(i, () => fired++);
            }

            var calls = 0;
            while (!clock.AdvanceTo(4.0, () => false))
            {
                calls++;
                Assert.True(calls < 10, "an advance that fires nothing never finishes");
            }

            Assert.Equal(4, fired);
        }

        [Fact]
        public void ACallbackThatSchedulesItsSuccessorInsideTheAdvanceCannotHoldIt()
        {
            var clock = new ManualClock();
            var fired = 0;
            void Again()
            {
                fired++;
                clock.Schedule(clock.Now() - 1.0, Again);
            }
            clock.Schedule(1.0, Again);

            Assert.False(clock.AdvanceTo(100.0, () => fired < 50));
            Assert.Equal(50, fired);
        }

        [Fact]
        public void AnInstantBehindTheClockMovesNoTimeAndStillFiresWhatIsDue()
        {
            var clock = new ManualClock();
            var fired = new List<int>();
            clock.Schedule(1.0, () => fired.Add(1));
            clock.Schedule(2.0, () => fired.Add(2));
            Assert.False(clock.AdvanceTo(5.0, () => false));

            Assert.True(clock.AdvanceTo(3.0, () => true));

            Assert.Equal(5.0, clock.Now());
            Assert.Equal(new[] { 1, 2 }, fired);
        }

        [Fact]
        public void WhatAStoppedAdvanceLeftIsFiredByAPlainAdvance()
        {
            var clock = new ManualClock();
            var fired = new List<int>();
            clock.Schedule(1.0, () => fired.Add(1));
            clock.Schedule(2.0, () => fired.Add(2));
            clock.Schedule(7.0, () => fired.Add(7));
            Assert.False(clock.AdvanceTo(5.0, () => false));

            clock.AdvanceTo(6.0);

            Assert.Equal(new[] { 1, 2 }, fired);
            Assert.Equal(7.0, clock.NextDueUt);
        }

        [Fact]
        public void ACancelledCallbackIsNotCountedAsProgress()
        {
            var clock = new ManualClock();
            var fired = new List<int>();
            var cancel = clock.Schedule(1.0, () => fired.Add(1));
            clock.Schedule(2.0, () => fired.Add(2));
            cancel();

            Assert.True(clock.AdvanceTo(5.0, () => false));
            Assert.Equal(new[] { 2 }, fired);
        }
    }
}
