using System;
using Xunit;

namespace Gonogo.KSP.Tests.CurrencyDelay
{
    /// <summary>
    /// Where the away-science arm gets the AMOUNT it is told a change was worth,
    /// which no unit test can reach: <c>StockCurrencyInterceptor.cs</c> needs a
    /// live scene and is not compiled into this project at all.
    ///
    /// <para><b>Source text, not behaviour</b>, and for the reason
    /// <c>CurrencyDelaySettlePumpIsWiredTests</c> spells out: a test that calls the
    /// rule itself proves the rule works and says nothing about whether the shipped
    /// game reaches it. The defect below lived in exactly that gap, and was found
    /// on the rig rather than here.</para>
    ///
    /// <para>Where that arm gets the DELAY is the other half, and lives in
    /// <see cref="AwayScienceOriginIsResolvedTests"/> beside the headless
    /// exercise of the roster walk it now shares with the per-increment
    /// sink.</para>
    /// </summary>
    public class AwayScienceArmIsWiredTests
    {
        /// <summary>
        /// The base a currency change was asked for comes off the modifier query
        /// that precedes it, and which query is evidence about which currency is
        /// <c>CurrencyQueryBases</c>'s rule. Held as loose fields on the
        /// interceptor it was one shared slot, and on an RP-1 install a second
        /// query fired between the real one and the change (Confidence pricing
        /// itself through <c>CurrencyUtils.Conf</c>, same reason, zero science)
        /// erased the base. The change then resolved AWAY with a base of zero and
        /// the arm did nothing at all.
        /// </summary>
        [Fact]
        public void the_interceptor_reads_its_query_bases_through_the_per_currency_rule()
        {
            var interceptor = CurrencyDelaySourceText.Read("StockCurrencyInterceptor.cs");

            Assert.Contains("CurrencyQueryBases", interceptor, StringComparison.Ordinal);

            // The single shared slot these named is what the rule replaced. Any of
            // them back means a query is once again evidence about every currency.
            Assert.DoesNotContain("_haveQuery", interceptor, StringComparison.Ordinal);
            Assert.DoesNotContain("_queryScience", interceptor, StringComparison.Ordinal);
        }
    }
}
