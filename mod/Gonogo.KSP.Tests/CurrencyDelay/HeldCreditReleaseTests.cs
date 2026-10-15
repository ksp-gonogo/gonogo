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
    }
}
