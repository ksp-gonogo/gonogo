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
            Assert.True(VesselListStanding.Stands(inFlight: true, flightReady: true, listed: 7, inGameState: 7));
            Assert.False(VesselListStanding.Stands(inFlight: true, flightReady: false, listed: 7, inGameState: 7));
            Assert.False(VesselListStanding.Stands(inFlight: true, flightReady: false, listed: 0, inGameState: 7));
        }

        [Fact]
        public void OutOfFlightAnEmptyListInAGameThatHasVesselsHasNotBeenFilledYet()
        {
            Assert.False(VesselListStanding.Stands(inFlight: false, flightReady: false, listed: 0, inGameState: 7));
            Assert.True(VesselListStanding.Stands(inFlight: false, flightReady: false, listed: 7, inGameState: 7));
        }

        [Fact]
        public void AGameWithNoVesselsHasAnEmptyListThatStands()
        {
            Assert.True(VesselListStanding.Stands(inFlight: false, flightReady: false, listed: 0, inGameState: 0));
            Assert.True(VesselListStanding.Stands(inFlight: false, flightReady: false, listed: 0, inGameState: null));
        }

        [Fact]
        public void InFlightAnEmptyListStandsOnceFlightIsReadySoALastCraftLostIsSeenToGo()
        {
            Assert.True(VesselListStanding.Stands(inFlight: true, flightReady: true, listed: 0, inGameState: 3));
        }
    }
}
