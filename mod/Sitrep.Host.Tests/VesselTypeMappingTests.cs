using System;
using Sitrep.Host;
using Xunit;

namespace Sitrep.Host.Tests
{
    public class VesselTypeMappingTests
    {
        /// <summary>Every member of KSP's own <c>VesselType</c> enum.</summary>
        [Theory]
        [InlineData("Debris")]
        [InlineData("SpaceObject")]
        [InlineData("Unknown")]
        [InlineData("Probe")]
        [InlineData("Relay")]
        [InlineData("Rover")]
        [InlineData("Lander")]
        [InlineData("Ship")]
        [InlineData("Plane")]
        [InlineData("Station")]
        [InlineData("Base")]
        [InlineData("EVA")]
        [InlineData("Flag")]
        [InlineData("DeployedScienceController")]
        [InlineData("DeployedSciencePart")]
        [InlineData("DroppedPart")]
        [InlineData("DeployedGroundPart")]
        public void EveryTypeTheGameHasMapsToTheContractMemberOfTheSameName(string gameName)
        {
            var parsed = SharedMappers.ParseVesselType(gameName);

            Assert.Equal(gameName, parsed.ToString());
        }

        [Fact]
        public void ATypeTheContractDoesNotKnowIsUnknown()
        {
            Assert.Equal(Sitrep.Contract.VesselType.Unknown, SharedMappers.ParseVesselType("Dirigible"));
            Assert.Equal(Sitrep.Contract.VesselType.Unknown, SharedMappers.ParseVesselType(null));
        }
    }
}
