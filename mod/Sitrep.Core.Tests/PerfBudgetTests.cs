using System.Collections.Generic;
using Sitrep.Contract;
using Xunit;

namespace Sitrep.Core.Tests
{
    public class PerfBudgetTests
    {
        [Fact]
        public void StaysSilentUnderThreshold()
        {
            var warnings = new List<string>();
            var budget = new PerfBudget("test", threshold: 10, windowSec: 1.0, warn: warnings.Add);

            budget.Record(5, at: 0.0);
            budget.Record(4, at: 0.5);

            Assert.Equal(9, budget.Rate(0.5));
            Assert.Empty(warnings);
            Assert.Equal(0, budget.ExceedanceCount);
        }

        [Fact]
        public void WarnsOnceWhenTheWindowedSumExceedsTheThreshold()
        {
            var warnings = new List<string>();
            var budget = new PerfBudget("hot-path", threshold: 10, windowSec: 1.0, warn: warnings.Add);

            budget.Record(6, at: 0.0);
            budget.Record(6, at: 0.1); // sum=12 > 10, first exceedance -> warns
            budget.Record(6, at: 0.2); // still within the same window's rate-limit -> no second warn

            Assert.Single(warnings);
            Assert.Contains("hot-path", warnings[0]);
            Assert.Equal(2, budget.ExceedanceCount);
        }

        [Fact]
        public void WarnsAgainAfterTheWindowElapses()
        {
            var warnings = new List<string>();
            var budget = new PerfBudget("hot-path", threshold: 10, windowSec: 1.0, warn: warnings.Add);

            budget.Record(11, at: 0.0);
            budget.Record(11, at: 2.0); // a fresh window, past the rate-limit

            Assert.Equal(2, warnings.Count);
        }

        [Fact]
        public void OldSamplesRollOffTheWindow()
        {
            var budget = new PerfBudget("rolling", threshold: 100, windowSec: 1.0);

            budget.Record(5, at: 0.0);
            Assert.Equal(5, budget.Rate(0.0));

            // Past the 1s window: the first sample should have rolled off.
            Assert.Equal(0, budget.Rate(1.5));
        }

        [Fact]
        public void ExceedanceCountIncrementsEveryRecordOverThresholdNotJustEveryWarn()
        {
            var budget = new PerfBudget("counted", threshold: 1, windowSec: 1.0, warn: _ => { });

            budget.Record(2, at: 0.0);
            budget.Record(2, at: 0.1);
            budget.Record(2, at: 0.2);

            Assert.Equal(3, budget.ExceedanceCount);
        }
    }
}
