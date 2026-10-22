using System;
using Gonogo.KSP.Tests.CurrencyDelay;
using Xunit;

namespace Gonogo.KSP.Tests
{
    public class BalanceRoundingTests
    {
        [Theory]
        [InlineData(32947.9990234375, 32948.0)]
        [InlineData(199347.9990234375, 199348.0)]
        [InlineData(41.99995422363281, 42.0)]
        [InlineData(219308.44, 219308.44)]
        public void FloatNoiseInABalanceIsRoundedAwayAndRealCentsAreKept(double read, double expected)
        {
            Assert.Equal(expected, BalanceRounding.Round(read));
        }

        [Fact]
        public void TwoReadsOfOneBalanceWithDifferentNoiseAreTheSameValue()
        {
            Assert.Equal(BalanceRounding.Round(32947.9990234375), BalanceRounding.Round(32948.0009765625));
        }

        [Fact]
        public void TheCareerBalancesArePublishedThroughIt()
        {
            var source = CurrencyDelaySourceText.ReadRelative("KspHost.cs");
            var body = CurrencyDelaySourceText.MethodBody(source, "private static Dictionary<string, object?>? BuildCareerBalances()");

            foreach (var field in new[] { "funding.Funds", "reputation.reputation", "rnd.Science" })
            {
                Assert.Contains("BalanceRounding.Round(" + field + ")", body, StringComparison.Ordinal);
            }
        }
    }
}
