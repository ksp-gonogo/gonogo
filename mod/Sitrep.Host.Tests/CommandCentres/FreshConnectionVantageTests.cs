using System.Linq;
using Sitrep.Contract;
using Sitrep.Host.CommandCentres;
using Xunit;

namespace Sitrep.Host.Tests.CommandCentres
{
    public class FreshConnectionVantageTests
    {
        private static readonly GroundSite[] Ground =
        {
            new GroundSite("ground:Woomerang Station", null),
            new GroundSite("ground:Kerbal Space Center", null),
            new GroundSite("ground:Dessert Station", null),
        };
        private static readonly string[] Active = { "ground:Woomerang Station", "ground:Kerbal Space Center", "ground:Dessert Station", "vessel:abc" };

        [Fact]
        public void AnIdentifiedHome_IsWhereAFreshConnectionStarts_HoweverTheIdsSort()
        {
            var vantage = FreshConnectionVantage.Choose(
                Active, Ground, HomeCommand.Identified("ground:Woomerang Station"), null);

            Assert.Equal("ground:Woomerang Station", vantage);
        }

        [Fact]
        public void NoHomeIdentifiedAndNoPositionKnown_StartsAtTheFirstGroundStationInOrdinalIdOrder()
        {
            var vantage = FreshConnectionVantage.Choose(Active, Ground, HomeCommand.NotIdentified, null);

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
                Active, Ground, HomeCommand.Identified("ground:Somewhere Else"), null);

            Assert.Equal("ground:Dessert Station", vantage);
        }

        /// <summary>A crewed craft is a centre, but never where a fresh connection lands by default.</summary>
        [Fact]
        public void NoGroundStation_IsNone_EvenWithAVesselCentreActive()
        {
            var vantage = FreshConnectionVantage.Choose(
                new[] { "vessel:abc" }, new GroundSite[0], HomeCommand.NotIdentified, null);

            Assert.Equal(FreshConnectionVantage.None, vantage);
        }

        [Fact]
        public void NoCentresAtAll_IsNone()
        {
            Assert.Equal(
                FreshConnectionVantage.None,
                FreshConnectionVantage.Choose(new string[0], new GroundSite[0], HomeCommand.NotIdentified, null));
        }

        private static readonly SurfaceSite SpaceCentre = new SurfaceSite(28.6083, -80.6041);

        /// <summary>
        /// The alphabetically first station is only ever the answer when nothing says
        /// where anything is. Knowing where the space centre stands, the stand-in is the
        /// station nearest it, whatever its name sorts as.
        /// </summary>
        [Fact]
        public void NoHomeIdentified_StartsAtTheStationNearestTheSpaceCentre_NotTheFirstByName()
        {
            var ground = new[]
            {
                new GroundSite("ground:ASF - Alaska Satellite Facility", new SurfaceSite(64.86, -147.85)),
                new GroundSite("ground:Cape Canaveral", new SurfaceSite(28.5, -80.57)),
                new GroundSite("ground:DSS 63 - Madrid", new SurfaceSite(40.43, -4.25)),
            };

            var vantage = FreshConnectionVantage.Choose(
                ground.Select(g => g.Id).ToList(), ground, HomeCommand.NotIdentified, SpaceCentre);

            Assert.Equal("ground:Cape Canaveral", vantage);
        }

        [Fact]
        public void AStationWithNoPositionRanksBehindOneThatHasIt()
        {
            var ground = new[]
            {
                new GroundSite("ground:ASF", null),
                new GroundSite("ground:Far Station", new SurfaceSite(-60.0, 100.0)),
            };

            var vantage = FreshConnectionVantage.Choose(
                ground.Select(g => g.Id).ToList(), ground, HomeCommand.NotIdentified, SpaceCentre);

            Assert.Equal("ground:Far Station", vantage);
        }

        [Fact]
        public void TwoStationsAtTheSameDistance_TieBreakByOrdinalId()
        {
            var here = new SurfaceSite(28.5, -80.57);
            var ground = new[] { new GroundSite("ground:B", here), new GroundSite("ground:A", here) };

            var vantage = FreshConnectionVantage.Choose(
                ground.Select(g => g.Id).ToList(), ground, HomeCommand.NotIdentified, SpaceCentre);

            Assert.Equal("ground:A", vantage);
        }
    }
}
