using System;
using Xunit;

namespace Sitrep.Contract.Tests
{
    /// <summary>A load is exactly one of a craft or a reason, and nothing can make it both or neither.</summary>
    public class CraftLoadTests
    {
        [Fact]
        public void ALoadedCraftCarriesTheShipAndNoFailure()
        {
            var ship = new object();

            var load = CraftLoad.Loaded(ship);

            Assert.Same(ship, load.Ship);
            Assert.Null(load.Failure);
        }

        [Fact]
        public void AFailedLoadCarriesTheReasonAndNoShip()
        {
            var load = CraftLoad.Failed("the craft file could not be read");

            Assert.Null(load.Ship);
            Assert.Equal("the craft file could not be read", load.Failure);
        }

        [Fact]
        public void NeitherAShipNorAReasonIsRefused()
        {
            Assert.Throws<ArgumentNullException>(() => CraftLoad.Loaded(null!));
            Assert.Throws<ArgumentException>(() => CraftLoad.Failed(" "));
        }

        [Fact]
        public void NothingCanBeSetAfterTheLoadIsMade()
        {
            foreach (var property in typeof(CraftLoad).GetProperties())
            {
                Assert.Null(property.SetMethod);
            }
        }
    }
}
