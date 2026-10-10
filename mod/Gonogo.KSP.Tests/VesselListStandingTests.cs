using Gonogo.KSP;
using Xunit;

namespace Gonogo.KSP.Tests
{
    /// <summary>
    /// The game's vessel list is not read while a scene is loading: an empty
    /// list in a game that has vessels is a list not yet filled, and it must
    /// not be taken as every craft having gone.
    /// </summary>
    public class VesselListStandingTests
    {
        [Fact]
        public void InFlightTheListStandsOnceTheGameSaysFlightIsReady()
        {
            Assert.True(VesselListStanding.Stands(inFlight: true, flightReady: true, flightHeld: false, listed: 7, inGameState: 7));
            Assert.False(VesselListStanding.Stands(inFlight: true, flightReady: false, flightHeld: false, listed: 7, inGameState: 7));
            Assert.False(VesselListStanding.Stands(inFlight: true, flightReady: false, flightHeld: false, listed: 0, inGameState: 7));
        }

        [Fact]
        public void OutOfFlightAnEmptyListInAGameThatHasVesselsHasNotBeenFilledYet()
        {
            Assert.False(VesselListStanding.Stands(inFlight: false, flightReady: false, flightHeld: false, listed: 0, inGameState: 7));
            Assert.True(VesselListStanding.Stands(inFlight: false, flightReady: false, flightHeld: false, listed: 7, inGameState: 7));
        }

        [Fact]
        public void AGameWithNoVesselsHasAnEmptyListThatStands()
        {
            Assert.True(VesselListStanding.Stands(inFlight: false, flightReady: false, flightHeld: false, listed: 0, inGameState: 0));
            Assert.True(VesselListStanding.Stands(inFlight: false, flightReady: false, flightHeld: false, listed: 0, inGameState: null));
        }

        [Fact]
        public void InFlightAnEmptyListStandsOnceFlightIsReadySoALastCraftLostIsSeenToGo()
        {
            Assert.True(VesselListStanding.Stands(inFlight: true, flightReady: true, flightHeld: false, listed: 0, inGameState: 3));
        }

        [Fact]
        public void InFlightAListThatStoodStillStandsAfterTheGameClearsFlightReadyForALostCraft()
        {
            Assert.True(VesselListStanding.Stands(inFlight: true, flightReady: false, flightHeld: true, listed: 0, inGameState: 3));
            Assert.True(VesselListStanding.Stands(inFlight: true, flightReady: false, flightHeld: true, listed: 5, inGameState: 6));
        }

        [Fact]
        public void AFlightListThatStoodKeepsStandingUntilTheNextSceneLoadIsRequested()
        {
            var watch = new VesselListWatch();
            Assert.False(watch.Stands("FLIGHT", true, false, 0, 3, 1.0));
            Assert.True(watch.Stands("FLIGHT", true, true, 4, 4, 2.0));
            Assert.True(watch.Stands("FLIGHT", true, false, 3, 4, 3.0));
            Assert.True(watch.Stands("FLIGHT", true, false, 0, 3, 4.0));
            watch.SceneLoadRequested();
            Assert.False(watch.Stands("FLIGHT", true, false, 0, 3, 5.0));
            Assert.True(watch.Stands("FLIGHT", true, true, 4, 4, 6.0));
        }

        [Fact]
        public void TheFlightMemoryDoesNotCarryIntoAnotherScene()
        {
            var watch = new VesselListWatch();
            Assert.True(watch.Stands("FLIGHT", true, true, 4, 4, 1.0));
            Assert.True(watch.Stands("SPACECENTER", false, false, 4, 4, 2.0));
            Assert.False(watch.Stands("FLIGHT", true, false, 0, 4, 3.0));
        }
    }
}
