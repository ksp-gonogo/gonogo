using System;
using System.Reflection;
using Gonogo.KSP.CurrencyDelay;
using Gonogo.KSP.Tests.Comms;
using Sitrep.Host.Comms;
using Xunit;

namespace Gonogo.KSP.Tests.CurrencyDelay
{
    /// <summary>
    /// What <see cref="StockCurrencyInterceptor"/> writes to the ledger when a
    /// crewed craft is destroyed: the reputation penalty for its crew is held for
    /// the signal delay read off the craft at the moment it was destroyed, or for
    /// the silence deadline when it had no route. Each test drives the two
    /// handlers KSP fires for one destruction, in the order an unloaded craft
    /// fires them: the destruction first, then the crew's reputation change.
    /// </summary>
    [Collection(CommsCoreUplinkStatics.Name)]
    public class CrewDeathCaptureTests
    {
        private const double DeathUt = 100.0;
        private const double Deadline = 3_600.0;
        private const double OneLightSecond = SignalDelay.SpeedOfLightMetersPerSecond;

        private static readonly Guid CraftId = new Guid("11111111-0000-0000-0000-000000000000");

        private static SignalDelayConfig DelayOn() =>
            new SignalDelayConfig { Enabled = true, LightSpeedScale = 1.0, SilenceDeclarationSeconds = Deadline };

        private static StockCurrencyInterceptor Interceptor(PendingCreditLedger ledger) =>
            new StockCurrencyInterceptor(ledger, new VesselScienceAggregator(), new CurrencyDelayGuard());

        private static void Fire(StockCurrencyInterceptor interceptor, string handler, params object?[] args) =>
            typeof(StockCurrencyInterceptor)
                .GetMethod(handler, BindingFlags.NonPublic | BindingFlags.Instance)!
                .Invoke(interceptor, args);

        private static void Destroy(StockCurrencyInterceptor interceptor, Vessel craft) =>
            Fire(interceptor, "OnVesselWillDestroy", craft);

        private static void CrewDies(StockCurrencyInterceptor interceptor, float reputationAfter) =>
            Fire(interceptor, "OnReputationChanged", reputationAfter, TransactionReasons.VesselLoss);

        [Fact]
        public void ACrewDeathOnACraftWithNoRouteIsHeldForHomeToHearOfIt()
        {
            using var ksp = new UnityStandIns(DeathUt, DelayOn());
            var ledger = new PendingCreditLedger();
            var interceptor = Interceptor(ledger);

            Destroy(interceptor, UnityStandIns.Craft(CraftId, UnityStandIns.Link(connected: false)));
            CrewDies(interceptor, reputationAfter: -10f);

            var row = Assert.Single(ledger.Pending);
            Assert.Equal(DelayedCurrency.Reputation, row.Currency);
            Assert.Equal(-10.0, row.BaseAmount);
            Assert.Equal(DeathUt, row.HeldSinceUt);
            Assert.Equal(CraftId.ToString(), row.OriginVesselId);
            Assert.Empty(ledger.PopMatured(DeathUt + Deadline * 100));
            Assert.Empty(ksp.Logged);
        }

        [Fact]
        public void ACrewDeathOnACraftWithNoLinkAtAllIsHeldForHomeToHearOfIt()
        {
            using var ksp = new UnityStandIns(DeathUt, DelayOn());
            var ledger = new PendingCreditLedger();
            var interceptor = Interceptor(ledger);

            Destroy(interceptor, UnityStandIns.Craft(CraftId));
            CrewDies(interceptor, reputationAfter: -10f);

            Assert.Equal(DeathUt, Assert.Single(ledger.Pending).HeldSinceUt);
        }

        [Fact]
        public void ACrewDeathOnACraftRoutedHomeIsHeldForTheRoutesSignalDelay()
        {
            using var ksp = new UnityStandIns(DeathUt, DelayOn());
            var ledger = new PendingCreditLedger();
            var interceptor = Interceptor(ledger);

            Destroy(interceptor, UnityStandIns.Craft(CraftId, UnityStandIns.Link(connected: true, UnityStandIns.Hop(OneLightSecond, endsAtHome: true))));
            CrewDies(interceptor, reputationAfter: -10f);

            Assert.Equal(DeathUt + 1.0, Assert.Single(ledger.Pending).RevealUt, 9);
        }

        /// <summary>
        /// The route is timed hop by hop and its last hop is not asked where it
        /// ends, so a path that stops at another craft is held for its own
        /// length as if it had reached home.
        /// </summary>
        [Fact]
        public void ACrewDeathOnACraftRoutedOnlyToAnotherCraftIsHeldForThatRoutesSignalDelay()
        {
            using var ksp = new UnityStandIns(DeathUt, DelayOn());
            var ledger = new PendingCreditLedger();
            var interceptor = Interceptor(ledger);

            Destroy(interceptor, UnityStandIns.Craft(CraftId, UnityStandIns.Link(connected: true, UnityStandIns.Hop(OneLightSecond, endsAtHome: false))));
            CrewDies(interceptor, reputationAfter: -10f);

            Assert.Equal(DeathUt + 1.0, Assert.Single(ledger.Pending).RevealUt, 9);
        }

        [Fact]
        public void TheRouteIsReadWhenTheCraftIsDestroyedNotWhenItsCrewIsCharged()
        {
            using var ksp = new UnityStandIns(DeathUt, DelayOn());
            var ledger = new PendingCreditLedger();
            var interceptor = Interceptor(ledger);
            var craft = UnityStandIns.Craft(CraftId, UnityStandIns.Link(connected: true, UnityStandIns.Hop(OneLightSecond, endsAtHome: true)));

            Destroy(interceptor, craft);
            craft.connection = UnityStandIns.Link(connected: false);
            CrewDies(interceptor, reputationAfter: -10f);

            Assert.Equal(DeathUt + 1.0, Assert.Single(ledger.Pending).RevealUt, 9);
        }

        /// <summary>
        /// A crew death that no destruction explains is left on the live balance:
        /// nothing reaches the ledger, however long it waits.
        /// </summary>
        [Fact]
        public void ACrewDeathOnACraftThatIsNotDestroyedNeverReachesTheLedger()
        {
            using var ksp = new UnityStandIns(DeathUt, DelayOn());
            var ledger = new PendingCreditLedger();
            var interceptor = Interceptor(ledger);

            CrewDies(interceptor, reputationAfter: -10f);
            ksp.Ut = DeathUt + 3.0;
            interceptor.SettleStaleDefers(DeathUt + 3.0);

            Assert.Empty(ledger.Pending);
        }

        /// <summary>A kerbal dies of life support or power on a craft that survives: the kerbal is taken off the craft, then marked dead, then charged.</summary>
        private static void DiesAboard(StockCurrencyInterceptor interceptor, Vessel craft, TransactionReasons reason)
        {
            interceptor.NoteAboard("Jebediah Kerman", craft);
            interceptor.NoteCrewDied("Jebediah Kerman", DeathUt);
            Fire(interceptor, "OnReputationChanged", -10f, reason);
        }

        [Fact]
        public void ACrewDeathOnASurvivingCraftWithNoRouteIsHeldForHomeToHearOfIt()
        {
            using var ksp = new UnityStandIns(DeathUt, DelayOn());
            var ledger = new PendingCreditLedger();
            var interceptor = Interceptor(ledger);

            DiesAboard(interceptor, UnityStandIns.Craft(CraftId, UnityStandIns.Link(connected: false)), TransactionReasons.VesselLoss);

            var row = Assert.Single(ledger.Pending);
            Assert.Equal(DeathUt, row.HeldSinceUt);
            Assert.Equal(CraftId.ToString(), row.OriginVesselId);
        }

        [Fact]
        public void ACrewDeathOnASurvivingCraftRoutedHomeIsHeldForTheRoutesSignalDelay()
        {
            using var ksp = new UnityStandIns(DeathUt, DelayOn());
            var ledger = new PendingCreditLedger();
            var interceptor = Interceptor(ledger);

            DiesAboard(interceptor, UnityStandIns.Craft(CraftId, UnityStandIns.Link(connected: true, UnityStandIns.Hop(OneLightSecond, endsAtHome: true))), TransactionReasons.VesselLoss);

            Assert.Equal(DeathUt + 1.0, Assert.Single(ledger.Pending).RevealUt, 9);
        }

        /// <summary>A mod can charge a crew-death penalty of its own under any reason, and it is the craft's like stock's.</summary>
        [Fact]
        public void AModsOwnCrewDeathPenaltyIsTheCraftsToo()
        {
            using var ksp = new UnityStandIns(DeathUt, DelayOn());
            var ledger = new PendingCreditLedger();
            var interceptor = Interceptor(ledger);

            DiesAboard(interceptor, UnityStandIns.Craft(CraftId, UnityStandIns.Link(connected: false)), TransactionReasons.Any);

            Assert.Equal(DeathUt, Assert.Single(ledger.Pending).HeldSinceUt);
        }

        [Fact]
        public void WithSignalDelayOffACrewDeathOnACraftWithNoRouteIsRevealedAtTheInstantItHappened()
        {
            using var ksp = new UnityStandIns(DeathUt, new SignalDelayConfig { Enabled = false, SilenceDeclarationSeconds = Deadline });
            var ledger = new PendingCreditLedger();
            var interceptor = Interceptor(ledger);

            Destroy(interceptor, UnityStandIns.Craft(CraftId, UnityStandIns.Link(connected: false)));
            CrewDies(interceptor, reputationAfter: -10f);

            Assert.Equal(DeathUt, Assert.Single(ledger.Pending).RevealUt);
        }
    }
}
