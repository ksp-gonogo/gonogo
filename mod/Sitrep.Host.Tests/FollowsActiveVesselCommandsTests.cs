using Sitrep.Host;
using Xunit;

namespace Sitrep.Host.Tests
{
    public class FollowsActiveVesselCommandsTests
    {
        /// <summary>
        /// The commands that run on the craft the game switched to when they were
        /// pressed as it switched. Each sets a state a second press undoes, and
        /// names nothing of one craft. Staging and abort are not among them.
        /// </summary>
        [Fact]
        public void TheCommandsThatFollowASwitchAreExactlyTheTaggedStateSetters()
        {
            var expected = new[]
            {
                "vessel.control.holdFlyByWire", "vessel.control.setActionGroup", "vessel.control.setAxes",
                "vessel.control.setBrakes", "vessel.control.setFlyByWire", "vessel.control.setGear",
                "vessel.control.setLights", "vessel.control.setPrecisionControl", "vessel.control.setRcs",
                "vessel.control.setSas", "vessel.control.setSasMode", "vessel.control.setThrottle",
            };

            Assert.Equal(expected, CommandDelayCatalog.FollowsActiveVesselCommandIds());
        }

        [Theory]
        [InlineData("vessel.control.setRcs", true)]
        [InlineData("vessel.control.stage", false)]
        [InlineData("vessel.control.setAbort", false)]
        [InlineData("vessel.invokePartAction", false)]
        [InlineData("no.such.command", false)]
        public void AOneWayOrUntaggedCommandDoesNotFollowASwitch(string command, bool follows)
        {
            Assert.Equal(follows, CommandDelayCatalog.FollowsActiveVessel(command));
        }
    }
}
