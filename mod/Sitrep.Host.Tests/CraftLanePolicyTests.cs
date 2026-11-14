using System.Collections.Generic;
using Xunit;

namespace Sitrep.Host.Tests
{
    public class CraftLanePolicyTests
    {
        private static Dictionary<string, object?> Entry() => new Dictionary<string, object?>
        {
            ["identity"] = new Dictionary<string, object?> { ["id"] = "x" },
            ["flight"] = new Dictionary<string, object?>(),
            ["attitude"] = new Dictionary<string, object?>(),
        };

        [Fact]
        public void ByDefaultEveryGroupTheGameHoldsIsKeptInEveryBand()
        {
            var policy = new CraftLanePolicy();
            foreach (var band in new[] { CraftBand.Unpacked, CraftBand.Packed, CraftBand.OnRails })
            {
                Assert.Equal(3, policy.Filter(band, Entry()).Count);
            }
        }

        [Fact]
        public void AWithheldGroupIsLeftOutOfThatBandAlone()
        {
            var policy = new CraftLanePolicy().Withhold(CraftBand.OnRails, "flight");

            Assert.False(policy.Filter(CraftBand.OnRails, Entry()).ContainsKey("flight"));
            Assert.True(policy.Filter(CraftBand.Packed, Entry()).ContainsKey("flight"));
        }

        [Fact]
        public void DebrisAndAsteroidsGetNoLaneAndShipsDo()
        {
            var policy = new CraftLanePolicy();

            Assert.False(policy.Reports("Debris"));
            Assert.False(policy.Reports("SpaceObject"));
            Assert.True(policy.Reports("Ship"));
            Assert.True(policy.Reports("Probe"));
        }

        [Fact]
        public void OnlyACraftOnRailsHoldsItsSavedTanks()
        {
            var policy = new CraftLanePolicy();

            Assert.True(policy.HoldsSavedTanks(CraftBand.OnRails));
            Assert.False(policy.HoldsSavedTanks(CraftBand.Packed));
        }
    }
}
