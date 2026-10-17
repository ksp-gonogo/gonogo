using Gonogo.KSP.CurrencyDelay;
using Sitrep.Host.Comms;
using Xunit;

namespace Gonogo.KSP.Tests.CurrencyDelay
{
    /// <summary>
    /// A held penalty lands once home has heard from the craft since it was
    /// charged, knows the craft is gone, or has declared it lost.
    /// </summary>
    public class HeldCreditReleaseTests
    {
        private const double ChargedUt = 500.0;

        private static HomeCraftView View(CentreContactState contact, double? lastContactUt, HomeVerdictState verdict) =>
            new HomeCraftView(contact, lastContactUt, verdict, verdict == HomeVerdictState.Lost ? 1 : 0);

        [Fact]
        public void ItLandsOnceHomeHasHeardFromTheCraftSinceTheCharge()
        {
            Assert.True(HeldCreditRelease.Lands(ChargedUt, View(CentreContactState.InContact, ChargedUt + 10, HomeVerdictState.Nominal)));
        }

        /// <summary>For one of home's delays after a craft goes silent, home still holds word of contact from before.</summary>
        [Fact]
        public void ItStaysHeldWhileHomesNewestWordOfContactIsFromBeforeTheCharge()
        {
            Assert.False(HeldCreditRelease.Lands(ChargedUt, View(CentreContactState.InContact, ChargedUt - 10, HomeVerdictState.Nominal)));
        }

        [Fact]
        public void ItStaysHeldWhileTheCraftIsSilent()
        {
            Assert.False(HeldCreditRelease.Lands(ChargedUt, View(CentreContactState.Silent, ChargedUt - 10, HomeVerdictState.Silent)));
        }

        [Fact]
        public void ItLandsWhenHomeDeclaresTheCraftLost()
        {
            Assert.True(HeldCreditRelease.Lands(ChargedUt, View(CentreContactState.Silent, ChargedUt - 10, HomeVerdictState.Lost)));
        }

        [Fact]
        public void ItLandsWhenHomeKnowsTheCraftIsGone()
        {
            Assert.True(HeldCreditRelease.Lands(ChargedUt, View(CentreContactState.Gone, ChargedUt - 10, HomeVerdictState.Gone)));
        }

        [Fact]
        public void ALandingOnALostDeclarationCarriesTheDeclarationsNumber()
        {
            Assert.Equal(1, HeldCreditRelease.DeclarationOf(View(CentreContactState.Silent, ChargedUt - 10, HomeVerdictState.Lost)));
            Assert.Equal(0, HeldCreditRelease.DeclarationOf(View(CentreContactState.InContact, ChargedUt + 10, HomeVerdictState.Nominal)));
        }

        [Fact]
        public void ItStaysHeldWhileHomeHasNoWordOfTheCraft()
        {
            Assert.False(HeldCreditRelease.Lands(ChargedUt, null));
        }

        private static HeldOutcome Science(HomeCraftView? view) => HeldCreditRelease.Outcome(DelayedCurrency.Science, ChargedUt, view);

        [Fact]
        public void HeldScienceLandsOnceHomeHasHeardFromTheCraftSinceItWasEarned()
        {
            Assert.Equal(HeldOutcome.Lands, Science(View(CentreContactState.InContact, ChargedUt + 10, HomeVerdictState.Nominal)));
        }

        [Fact]
        public void HeldScienceWaitsWhileTheCraftIsSilent()
        {
            Assert.Equal(HeldOutcome.Waits, Science(View(CentreContactState.Silent, ChargedUt - 10, HomeVerdictState.Silent)));
            Assert.Equal(HeldOutcome.Waits, Science(null));
        }

        /// <summary>The data never left the craft, so it is off the books for as long as the declaration stands.</summary>
        [Fact]
        public void HeldScienceIsForfeitedWhenHomeDeclaresTheCraftLost()
        {
            Assert.Equal(HeldOutcome.Forfeits, Science(View(CentreContactState.Silent, ChargedUt - 10, HomeVerdictState.Lost)));
        }

        [Fact]
        public void ForfeitedScienceIsKeptWhileTheDeclarationStands()
        {
            Assert.Equal(ForfeitFate.Keep, HeldCreditRelease.FateOfForfeit(1, View(CentreContactState.Silent, ChargedUt, HomeVerdictState.Lost)));
            Assert.Equal(ForfeitFate.Keep, HeldCreditRelease.FateOfForfeit(1, null));
        }

        [Fact]
        public void ForfeitedScienceIsGivenBackWhenContactReturnsAndTheDeclarationIsWithdrawn()
        {
            Assert.Equal(ForfeitFate.Restore, HeldCreditRelease.FateOfForfeit(1, View(CentreContactState.InContact, ChargedUt + 50, HomeVerdictState.Nominal)));
        }

        [Fact]
        public void ForfeitedScienceIsGivenBackWhenALaterDeclarationHasReplacedTheOne()
        {
            var again = new HomeCraftView(CentreContactState.Silent, ChargedUt, HomeVerdictState.Lost, 2);
            Assert.Equal(ForfeitFate.Restore, HeldCreditRelease.FateOfForfeit(1, again));
        }

        [Fact]
        public void ForfeitedScienceIsDiscardedOnceHomeKnowsTheCraftHasGone()
        {
            Assert.Equal(ForfeitFate.Discard, HeldCreditRelease.FateOfForfeit(1, View(CentreContactState.Gone, ChargedUt, HomeVerdictState.Gone)));
        }

        [Fact]
        public void HeldScienceIsDroppedWhenTheCraftWentWithoutAWordSinceItWasEarned()
        {
            Assert.Equal(HeldOutcome.Drops, Science(View(CentreContactState.Gone, ChargedUt - 10, HomeVerdictState.Gone)));
        }

        /// <summary>Home heard from the craft after the science was earned, then of its end: the data reached home first.</summary>
        [Fact]
        public void HeldScienceLandsWhenTheCraftWasHeardFromBeforeItWent()
        {
            Assert.Equal(HeldOutcome.Lands, Science(View(CentreContactState.Gone, ChargedUt + 10, HomeVerdictState.Gone)));
        }

        [Fact]
        public void AHeldPenaltyStillLandsOnALossDeclaration()
        {
            Assert.Equal(HeldOutcome.Lands, HeldCreditRelease.Outcome(DelayedCurrency.Reputation, ChargedUt, View(CentreContactState.Silent, ChargedUt - 10, HomeVerdictState.Lost)));
        }
}
}
