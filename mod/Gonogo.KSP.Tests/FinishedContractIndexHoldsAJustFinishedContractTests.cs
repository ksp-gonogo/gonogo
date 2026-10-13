using System;
using Gonogo.KSP.Tests.CurrencyDelay;
using Xunit;

namespace Gonogo.KSP.Tests
{
    /// <summary>
    /// Stock keeps a contract that has just finished in <c>ContractSystem.Contracts</c> in its
    /// terminal state until a later step moves it to <c>ContractsFinished</c>. A capture that
    /// lands in that window must still find it in the finished-contract index, or an alarm
    /// waiting on one of its objectives reads it as having left the career.
    ///
    /// <para>Source text, not behaviour: the capture reads live KSP and cannot be compiled
    /// into this project.</para>
    /// </summary>
    public class FinishedContractIndexHoldsAJustFinishedContractTests
    {
        private static readonly string Source = CurrencyDelaySourceText.ReadRelative("KspHost.cs");

        [Fact]
        public void a_terminal_contract_still_in_the_live_list_is_indexed()
        {
            var index = CurrencyDelaySourceText.MethodBody(Source, "private static Dictionary<string, object?>? BuildFinishedById(ContractSystem system)");

            Assert.Contains("system.Contracts", index, StringComparison.Ordinal);
            Assert.Contains("IsTerminal(contract.ContractState)", index, StringComparison.Ordinal);
        }

        [Fact]
        public void a_contract_still_generated_offered_or_active_is_not_terminal()
        {
            var terminal = CurrencyDelaySourceText.MethodBody(Source, "private static bool IsTerminal(Contract.State state)");

            Assert.Contains("Contract.State.Generated", terminal, StringComparison.Ordinal);
            Assert.Contains("Contract.State.Offered", terminal, StringComparison.Ordinal);
            Assert.Contains("Contract.State.Active", terminal, StringComparison.Ordinal);
        }
    }
}
