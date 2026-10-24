using System;
using Gonogo.KSP.Tests.CurrencyDelay;
using Xunit;

namespace Gonogo.KSP.Tests
{
    /// <summary>
    /// The award ledger is only as good as its wiring: a window opened by the recovery request,
    /// fed by the game's currency and progress events, and closed into the published summary.
    /// Read as source for the same reason <c>SandboxRecoveryIsWiredTests</c> is.
    /// </summary>
    public class RecoveryAwardsAreWiredTests
    {
        [Fact]
        public void the_recovery_request_opens_the_window_and_the_summary_closes_it()
        {
            var source = CurrencyDelaySourceText.ReadRelative("RecoveryUplink.cs");
            var hook = CurrencyDelaySourceText.MethodBody(source, "private void HookGameEvents()");

            foreach (var subscription in new[]
            {
                "GameEvents.OnVesselRecoveryRequested.Add(OnRecoveryRequested)",
                "GameEvents.OnProgressReached.Add(OnProgress)",
                "GameEvents.OnFundsChanged.Add(OnFundsChanged)",
                "GameEvents.OnReputationChanged.Add(OnReputationChanged)",
                "GameEvents.OnScienceChanged.Add(OnScienceChanged)",
            })
            {
                Assert.Contains(subscription, hook, StringComparison.Ordinal);
            }

            Assert.Contains("capture.Awards = _awards.Close();", source, StringComparison.Ordinal);
        }
    }
}
