using System;
using Gonogo.KSP.Tests.CurrencyDelay;
using Xunit;

namespace Gonogo.KSP.Tests
{
    /// <summary>
    /// The recent completed and failed lists are drawn from the finished-contract index's
    /// entries rather than built again on every sample, which only holds while the index is
    /// refreshed first in the same capture.
    ///
    /// <para>Source text, not behaviour: the capture reads live KSP and cannot be compiled
    /// into this project.</para>
    /// </summary>
    public class RecentContractsReuseTheFinishedIndexTests
    {
        private static readonly string Source = CurrencyDelaySourceText.ReadRelative("KspHost.cs");

        [Fact]
        public void the_recent_lists_take_the_indexed_entry()
        {
            var recent = CurrencyDelaySourceText.MethodBody(Source, "private static List<object?> BuildFinishedRecent(ContractSystem system, Contract.State state)");

            Assert.Contains("_finishedEntries.TryGetValue(", recent, StringComparison.Ordinal);
        }

        [Fact]
        public void the_index_is_refreshed_before_the_recent_lists_are_drawn()
        {
            var contracts = CurrencyDelaySourceText.MethodBody(Source, "private static Dictionary<string, object?>? BuildCareerContracts()");

            var index = contracts.IndexOf("BuildFinishedById(system)", StringComparison.Ordinal);
            var recent = contracts.IndexOf("BuildFinishedRecent(system", StringComparison.Ordinal);
            Assert.True(index >= 0 && recent > index, "the finished index must be built before the recent lists");
        }
    }
}
