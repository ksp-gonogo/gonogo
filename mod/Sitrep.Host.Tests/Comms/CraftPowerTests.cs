using Sitrep.Host.Comms;
using Xunit;

namespace Sitrep.Host.Tests.Comms
{
    public class CraftPowerTests
    {
        [Fact]
        public void ACraftWithChargeLeftIsPowered()
        {
            Assert.True(new CraftPower().Powered("a", 12.0, 50.0));
        }

        [Fact]
        public void ACraftWithItsBatteriesEmptyIsUnpowered()
        {
            Assert.False(new CraftPower().Powered("a", 0.0, 50.0));
        }

        [Fact]
        public void ACraftThatHoldsNoChargeHasNoReading()
        {
            Assert.Null(new CraftPower().Powered("eva", 0.0, 0.0));
        }

        [Fact]
        public void AnUnreadCraftHasNoReading()
        {
            Assert.Null(new CraftPower().Powered("a", null, 50.0));
            Assert.Null(new CraftPower().Powered("a", 1.0, null));
        }

        [Fact]
        public void AnEmptyCraftStaysUnpoweredUntilItHasRecharged()
        {
            var power = new CraftPower();
            Assert.False(power.Powered("a", 0.0, 50.0));
            Assert.False(power.Powered("a", 0.05, 50.0));
            Assert.True(power.Powered("a", CraftPower.RestoredEc, 50.0));
            Assert.True(power.Powered("a", 0.05, 50.0));
        }

        [Fact]
        public void ACraftThatLeftIsForgotten()
        {
            var power = new CraftPower();
            Assert.False(power.Powered("a", 0.0, 50.0));
            power.KeepOnly(new System.Collections.Generic.HashSet<string>());
            Assert.True(power.Powered("a", 0.05, 50.0));
        }

        [Fact]
        public void AnUnpoweredCraftHasNoLinkWhateverTheNetworkSays()
        {
            Assert.False(CraftPower.Link(true, false));
            Assert.True(CraftPower.Link(true, true));
            Assert.True(CraftPower.Link(true, null));
            Assert.Null(CraftPower.Link(null, true));
            Assert.False(CraftPower.Link(null, false));
        }
    }
}
