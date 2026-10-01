using System.Collections.Generic;
using Gonogo.KSP.Career;
using Xunit;

namespace Gonogo.KSP.Tests.Career
{
    /// <summary>
    /// The rule behind <c>spaceCenter.launchSites</c> occupancy is the one
    /// <c>PreFlightTests.LaunchSiteClear</c> applies when a launch is refused,
    /// so the two cannot disagree about a pad held by a vessel that is not the
    /// active one.
    /// </summary>
    public class LaunchSiteOccupancyTests
    {
        private static SiteVessel Craft(string landedAt, string name, bool debris = false) =>
            new SiteVessel(landedAt, name, debris);

        [Fact]
        public void AnEmptySaveLeavesEverySiteClear()
        {
            Assert.Null(LaunchSiteOccupancy.Holder("LaunchPad", new List<SiteVessel>()));
        }

        [Fact]
        public void ACraftLandedAtTheSiteHoldsItWhateverItsSituation()
        {
            var vessels = new[] { Craft("LaunchPad", "maxo corp contract") };

            Assert.Equal("maxo corp contract", LaunchSiteOccupancy.Holder("LaunchPad", vessels));
        }

        [Fact]
        public void ACraftAtAnotherSiteDoesNotHoldIt()
        {
            var vessels = new[] { Craft("Runway", "Plane") };

            Assert.Null(LaunchSiteOccupancy.Holder("LaunchPad", vessels));
            Assert.Equal("Plane", LaunchSiteOccupancy.Holder("Runway", vessels));
        }

        [Fact]
        public void LandedAtIsMatchedBySubstringAsStockDoes()
        {
            var vessels = new[] { Craft("KSC/Runway/Apron", "Plane") };

            Assert.Equal("Plane", LaunchSiteOccupancy.Holder("Runway", vessels));
        }

        [Fact]
        public void DebrisNeverHoldsASite()
        {
            var vessels = new[] { Craft("LaunchPad", "Booster Debris", debris: true) };

            Assert.Null(LaunchSiteOccupancy.Holder("LaunchPad", vessels));
        }

        [Fact]
        public void TheLastNonDebrisMatchIsTheReportedHolder()
        {
            var vessels = new[]
            {
                Craft("LaunchPad", "First"),
                Craft("LaunchPad", "Chunk", debris: true),
                Craft("LaunchPad", "Second"),
                Craft("LaunchPad", "Chunk 2", debris: true),
            };

            Assert.Equal("Second", LaunchSiteOccupancy.Holder("LaunchPad", vessels));
        }

        [Fact]
        public void AVesselWithNoLandedAtHoldsNothing()
        {
            var vessels = new[] { new SiteVessel(null, "Orbiter", false), Craft("", "Flying") };

            Assert.Null(LaunchSiteOccupancy.Holder("LaunchPad", vessels));
        }

        [Fact]
        public void AnUnnamedHolderStillHoldsTheSite()
        {
            var vessels = new[] { new SiteVessel("LaunchPad", null, false) };

            Assert.Equal("", LaunchSiteOccupancy.Holder("LaunchPad", vessels));
        }

        [Fact]
        public void ANamelessSiteIsNeverHeld()
        {
            Assert.Null(LaunchSiteOccupancy.Holder(null, new[] { Craft("LaunchPad", "X") }));
            Assert.Null(LaunchSiteOccupancy.Holder("", new[] { Craft("LaunchPad", "X") }));
        }
    }
}
