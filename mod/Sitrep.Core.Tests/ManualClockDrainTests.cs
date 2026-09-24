using System;
using System.Collections.Generic;
using System.Diagnostics;
using Sitrep.Core;
using Xunit;

namespace Sitrep.Core.Tests
{
    /// <summary>
    /// The drain order the golden fixtures pin, at the size a released reveal
    /// buffer schedules in one tick.
    /// </summary>
    public class ManualClockDrainTests
    {
        [Fact]
        public void FiresInInstantOrderWithTiesInScheduleOrderAndPicksUpWhatAFireSchedules()
        {
            var clock = new ManualClock();
            var fired = new List<string>();
            clock.Schedule(3, () => fired.Add("c"));
            clock.Schedule(1, () => fired.Add("a1"));
            var cancel = clock.Schedule(2, () => fired.Add("cancelled"));
            clock.Schedule(1, () =>
            {
                fired.Add("a2");
                clock.Schedule(1, () => fired.Add("a3"));
                clock.Schedule(2.5, () => fired.Add("b"));
            });
            clock.Schedule(9, () => fired.Add("later"));
            cancel();

            clock.AdvanceTo(5);

            Assert.Equal(new[] { "a1", "a2", "a3", "b", "c" }, fired);
            clock.AdvanceTo(9);
            Assert.Equal("later", fired[fired.Count - 1]);
        }

        /// <summary>
        /// Three hundred thousand deliveries due in one advance, on interleaved
        /// instants. Found by scanning every pending callback per fire this is
        /// some 4.5e10 comparisons; it has to take well under the bound on a
        /// loaded machine, and in order.
        /// </summary>
        [Fact]
        public void DrainingAReleasedBufferIsNotQuadratic()
        {
            const int count = 300_000;
            var clock = new ManualClock();
            var last = double.NegativeInfinity;
            var inOrder = true;
            var fires = 0;
            for (var i = 0; i < count; i++)
            {
                var at = (double)((long)i * 7919 % count);
                clock.Schedule(at, () =>
                {
                    inOrder &= at >= last;
                    last = at;
                    fires++;
                });
            }

            var watch = Stopwatch.StartNew();
            clock.AdvanceTo(count);

            Assert.Equal(count, fires);
            Assert.True(inOrder);
            Assert.True(watch.Elapsed < TimeSpan.FromSeconds(5), $"drained in {watch.ElapsedMilliseconds} ms");
        }
    }
}
