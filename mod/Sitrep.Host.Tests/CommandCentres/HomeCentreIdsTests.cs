using System.Linq;
using Sitrep.Host.CommandCentres;
using Xunit;

namespace Sitrep.Host.Tests.CommandCentres
{
    public class HomeCentreIdsTests
    {
        [Fact]
        public void Stock_TheOneFlaggedHomeIsKsc_AndEveryOtherIsGroundByName()
        {
            var ids = HomeCentreIds.Mint(new[]
            {
                new HomeNodeFacts(false, "Woomerang Station"),
                new HomeNodeFacts(true, "Kerbal Space Center"),
                new HomeNodeFacts(false, "Dessert Station"),
                new HomeNodeFacts(false, null),
            });

            Assert.Equal(
                new[] { "ground:Woomerang Station", "ksc", "ground:Dessert Station", "ground:unknown" },
                ids);
        }

        /// <summary>
        /// The comms-mod shape: every configured station is flagged, and the flag
        /// then names none of them. Before the mint every one of these was
        /// <c>"ksc"</c> and all but the first vanished at the registry.
        /// </summary>
        [Fact]
        public void EveryHomeFlagged_NoneIsKsc_AndAllAreDistinct()
        {
            var homes = new[]
            {
                new HomeNodeFacts(true, "DSS 14 - Goldstone"),
                new HomeNodeFacts(true, "DSS 43 - Canberra"),
                new HomeNodeFacts(true, "DSS 63 - Madrid"),
                new HomeNodeFacts(true, "Cape Canaveral"),
            };

            var ids = HomeCentreIds.Mint(homes);

            Assert.Equal(
                new[] { "ground:DSS 14 - Goldstone", "ground:DSS 43 - Canberra", "ground:DSS 63 - Madrid", "ground:Cape Canaveral" },
                ids);
            Assert.DoesNotContain(HomeCentreIds.Ksc, ids);
        }

        [Fact]
        public void EveryHomeFlagged_NoneDropsAtTheRegistry()
        {
            var homes = new[]
            {
                new HomeNodeFacts(true, "DSS 14 - Goldstone"),
                new HomeNodeFacts(true, "DSS 43 - Canberra"),
                new HomeNodeFacts(true, "DSS 63 - Madrid"),
            };
            var ids = HomeCentreIds.Mint(homes);
            var registry = new CommandCentreRegistry();
            registry.RegisterSource(new FakeCommandCentreSource(
                "stock-home", ids.Select(id => (Sitrep.Contract.ICommandCentre)new FakeCommandCentre(id)).ToArray()));

            Assert.Equal(3, registry.EnumerateActive().Count);
            Assert.Empty(registry.Collisions);
        }

        [Fact]
        public void NoHomeFlagged_NoneIsKsc()
        {
            var ids = HomeCentreIds.Mint(new[]
            {
                new HomeNodeFacts(false, "A"),
                new HomeNodeFacts(false, "B"),
            });

            Assert.Equal(new[] { "ground:A", "ground:B" }, ids);
        }

        [Fact]
        public void SharedNames_AreSuffixedByPosition_WhateverOrderTheyArriveIn()
        {
            var west = new HomeNodeFacts(false, "Relay", latitude: 0.0, longitude: -10.0);
            var east = new HomeNodeFacts(false, "Relay", latitude: 0.0, longitude: 10.0);
            var north = new HomeNodeFacts(false, "Relay", latitude: 40.0, longitude: 0.0);

            var forward = HomeCentreIds.Mint(new[] { west, east, north });
            var reversed = HomeCentreIds.Mint(new[] { north, east, west });

            Assert.Equal(new[] { "ground:Relay", "ground:Relay#2", "ground:Relay#3" }, forward);
            Assert.Equal(new[] { "ground:Relay#3", "ground:Relay#2", "ground:Relay" }, reversed);
        }

        [Fact]
        public void ASuffix_NeverTakesAnIdAnotherHomeMintsOnItsOwnName()
        {
            var ids = HomeCentreIds.Mint(new[]
            {
                new HomeNodeFacts(false, "Relay", latitude: 0.0),
                new HomeNodeFacts(false, "Relay", latitude: 1.0),
                new HomeNodeFacts(false, "Relay#2"),
            });

            Assert.Equal(new[] { "ground:Relay", "ground:Relay#3", "ground:Relay#2" }, ids);
            Assert.Equal(ids.Length, ids.Distinct().Count());
        }
    }
}
