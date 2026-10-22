using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Host;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// The <c>surface.sites</c> mapper: every flag planted in the save, an empty list when
    /// there is none, and nothing at all only for a recording made before the channel existed.
    /// </summary>
    public class SurfaceSitesViewProviderTests
    {
        private static KspSnapshot SnapshotWith(params object?[] sites) => new KspSnapshot
        {
            Ut = 0.0,
            Values = new Dictionary<string, object?> { ["surfaceSites"] = new List<object?>(sites) },
        };

        private static Dictionary<string, object?> Flag(string id) => new Dictionary<string, object?>
        {
            ["siteId"] = id,
            ["name"] = "Midlands Outpost",
            ["body"] = "Mun",
            ["latitude"] = 1.5,
            ["longitude"] = -20.25,
            ["plantedAt"] = 88100.0,
            ["plantedBy"] = "Maxwell Kerman",
            ["plaque"] = "First on the Mun",
        };

        [Fact]
        public void AFlagIsListedWithItsNamePlaceAndPlanter()
        {
            var wire = Assert.IsType<List<object?>>(SurfaceSitesViewProvider.BuildWire(SnapshotWith(Flag("flag-1"))));

            var site = Assert.IsType<Dictionary<string, object?>>(Assert.Single(wire));
            Assert.Equal("flag-1", site["siteId"]);
            Assert.Equal("Midlands Outpost", site["name"]);
            Assert.Equal("Mun", site["body"]);
            Assert.Equal(1.5, site["latitude"]);
            Assert.Equal(-20.25, site["longitude"]);
            Assert.Equal(88100.0, site["plantedAt"]);
            Assert.Equal("Maxwell Kerman", site["plantedBy"]);
            Assert.Equal("First on the Mun", site["plaque"]);
        }

        [Fact]
        public void NoFlagPlantedIsAnEmptyListRatherThanNothing()
        {
            Assert.Empty(Assert.IsType<List<object?>>(SurfaceSitesViewProvider.BuildWire(SnapshotWith())));
        }

        [Fact]
        public void ARecordingMadeBeforeTheChannelExistedMapsToNothingAtAll()
        {
            var snapshot = new KspSnapshot { Ut = 0.0, Values = new Dictionary<string, object?>() };

            Assert.Null(SurfaceSitesViewProvider.BuildWire(snapshot));
        }

        [Fact]
        public void AFlagWhoseModuleWasNotReadKeepsItsPlaceAndLeavesThePlaqueAndPlanterNull()
        {
            var unloaded = Flag("flag-1");
            unloaded.Remove("plantedBy");
            unloaded.Remove("plaque");

            var wire = Assert.IsType<List<object?>>(SurfaceSitesViewProvider.BuildWire(SnapshotWith(unloaded)));

            var site = Assert.IsType<Dictionary<string, object?>>(Assert.Single(wire));
            Assert.Equal(1.5, site["latitude"]);
            Assert.Null(site["plantedBy"]);
            Assert.Null(site["plaque"]);
        }

        [Fact]
        public void AnEntryWithNoSiteIdIsDroppedRatherThanListedAnonymously()
        {
            var nameless = Flag("flag-1");
            nameless["siteId"] = null;

            var wire = Assert.IsType<List<object?>>(SurfaceSitesViewProvider.BuildWire(SnapshotWith(nameless, Flag("flag-2"))));

            Assert.Equal("flag-2", Assert.IsType<Dictionary<string, object?>>(Assert.Single(wire))["siteId"]);
        }
    }
}
