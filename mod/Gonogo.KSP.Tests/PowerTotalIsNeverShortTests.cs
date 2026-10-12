using System;
using Gonogo.KSP.Tests.CurrencyDelay;
using Xunit;

namespace Gonogo.KSP.Tests
{
    /// <summary>
    /// <c>parts.power</c> publishes one production total. A solar panel or alternator whose
    /// read threw would leave it short with no sign, so the total is then null.
    ///
    /// <para>Source text, not behaviour: the walk reads live parts and cannot be compiled
    /// into this project.</para>
    /// </summary>
    public class PowerTotalIsNeverShortTests
    {
        private static string Body() => CurrencyDelaySourceText.MethodBody(
            CurrencyDelaySourceText.ReadRelative("KspHost.cs"),
            "private static Dictionary<string, object?>? BuildPartsPower(Vessel vessel)");

        [Theory]
        [InlineData("solar")]
        [InlineData("alternator")]
        public void a_producer_read_that_throws_voids_the_total(string kind)
        {
            var body = Body();
            var warning = body.IndexOf("parts.power " + kind + " read failed", StringComparison.Ordinal);
            var flagged = body.IndexOf("productionUnreadable = true;", warning, StringComparison.Ordinal);
            var nextTry = body.IndexOf("try", warning, StringComparison.Ordinal);

            Assert.True(warning >= 0);
            Assert.True(flagged > warning && (nextTry < 0 || flagged < nextTry), kind + " failure must mark the total unreadable");
        }

        [Fact]
        public void the_total_is_null_when_a_producer_was_unread()
        {
            Assert.Contains(
                "[\"totalProductionEc\"] = productionUnreadable ? null : (double?)totalProduction,",
                Body(),
                StringComparison.Ordinal);
        }
    }
}
