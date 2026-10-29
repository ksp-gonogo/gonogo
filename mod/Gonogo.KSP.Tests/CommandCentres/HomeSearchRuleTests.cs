using Gonogo.KSP.CommandCentres;
using Xunit;

namespace Gonogo.KSP.Tests.CommandCentres
{
    public class HomeSearchRuleTests
    {
        [Fact]
        public void AListIsKeptWhileTheNetworkHoldsTheSameStationNodes()
        {
            Assert.False(HomeSearchRule.SearchAgain(true, true, true, 30f, 9, 9));
            Assert.False(HomeSearchRule.SearchAgain(true, true, true, 30f, null, null));
        }

        [Fact]
        public void AStationThatJoinsOrLeavesTheNetworkSendsItSearchingAgain()
        {
            Assert.True(HomeSearchRule.SearchAgain(true, true, true, 0.1f, 10, 9));
            Assert.True(HomeSearchRule.SearchAgain(true, true, true, 0.1f, 8, 9));
            Assert.True(HomeSearchRule.SearchAgain(true, true, true, 0.1f, 9, null));
            Assert.True(HomeSearchRule.SearchAgain(true, true, true, 0.1f, null, 9));
        }

        [Fact]
        public void ADestroyedStationASceneChangeOrNoListSendsItSearchingAgain()
        {
            Assert.True(HomeSearchRule.SearchAgain(true, false, true, 0.1f, 9, 9));
            Assert.True(HomeSearchRule.SearchAgain(true, true, false, 0.1f, 9, 9));
            Assert.True(HomeSearchRule.SearchAgain(false, true, true, 0.1f, 9, 9));
        }

        [Fact]
        public void NoListIsKeptPastTheFallbackOrAcrossAClockThatWentBack()
        {
            Assert.True(HomeSearchRule.SearchAgain(true, true, true, HomeSearchRule.FallbackSeconds, 9, 9));
            Assert.True(HomeSearchRule.SearchAgain(true, true, true, -1f, 9, 9));
        }
    }
}
