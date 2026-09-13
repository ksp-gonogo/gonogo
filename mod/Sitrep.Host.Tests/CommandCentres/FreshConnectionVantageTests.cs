using Sitrep.Contract;
using Sitrep.Host.CommandCentres;
using Xunit;

namespace Sitrep.Host.Tests.CommandCentres
{
    public class FreshConnectionVantageTests
    {
        private static readonly string[] Ground = { "ground:Woomerang Station", "ground:Kerbal Space Center", "ground:Dessert Station" };
        private static readonly string[] Active = { "ground:Woomerang Station", "ground:Kerbal Space Center", "ground:Dessert Station", "vessel:abc" };

        [Fact]
        public void AnIdentifiedHome_IsWhereAFreshConnectionStarts_HoweverTheIdsSort()
        {
            var vantage = FreshConnectionVantage.Choose(
                Active, Ground, HomeCommand.Identified("ground:Woomerang Station"));

            Assert.Equal("ground:Woomerang Station", vantage);
        }

        [Fact]
        public void NoHomeIdentified_StartsAtTheFirstGroundStationInOrdinalIdOrder()
        {
            var vantage = FreshConnectionVantage.Choose(Active, Ground, HomeCommand.NotIdentified);

            Assert.Equal("ground:Dessert Station", vantage);
        }

        /// <summary>
        /// A claimant naming a centre that is not active names nowhere a connection can
        /// stand, so the fallback applies as if it had named nobody.
        /// </summary>
        [Fact]
        public void AHomeThatIsNotActive_FallsBackToTheFirstGroundStation()
        {
            var vantage = FreshConnectionVantage.Choose(
                Active, Ground, HomeCommand.Identified("ground:Somewhere Else"));

            Assert.Equal("ground:Dessert Station", vantage);
        }

        /// <summary>A crewed craft is a centre, but never where a fresh connection lands by default.</summary>
        [Fact]
        public void NoGroundStation_IsNone_EvenWithAVesselCentreActive()
        {
            var vantage = FreshConnectionVantage.Choose(
                new[] { "vessel:abc" }, new string[0], HomeCommand.NotIdentified);

            Assert.Equal(FreshConnectionVantage.None, vantage);
        }

        [Fact]
        public void NoCentresAtAll_IsNone()
        {
            Assert.Equal(
                FreshConnectionVantage.None,
                FreshConnectionVantage.Choose(new string[0], new string[0], HomeCommand.NotIdentified));
        }
    }
}
