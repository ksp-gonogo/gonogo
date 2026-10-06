using Gonogo.KSP;
using Xunit;

namespace Gonogo.KSP.Tests
{
    /// <summary>
    /// The bodies and the roster of every vessel are read in every scene of a
    /// loaded game, not only in flight, and never from a vessel list that is
    /// still being filled. The active vessel is read in flight alone.
    /// </summary>
    public class SystemCaptureTests
    {
        [Fact]
        public void InFlightTheSystemIsReadOnceFlightIsReadyAsBefore()
        {
            Assert.True(SystemCapture.ReadsTheSystem(globalsPresent: true, inAGame: true, inFlight: true, flightReady: true, listed: 7, inGameState: 7));
            Assert.False(SystemCapture.ReadsTheSystem(globalsPresent: true, inAGame: true, inFlight: true, flightReady: false, listed: 7, inGameState: 7));
        }

        [Fact]
        public void AtTheSpaceCentreTheTrackingStationAndInAnEditorTheSystemIsReadThoughFlightIsNotReady()
        {
            Assert.True(SystemCapture.ReadsTheSystem(globalsPresent: true, inAGame: true, inFlight: false, flightReady: false, listed: 34, inGameState: 34));
            Assert.True(SystemCapture.ReadsTheSystem(globalsPresent: true, inAGame: true, inFlight: false, flightReady: false, listed: 0, inGameState: 0));
        }

        [Fact]
        public void AListStillBeingFilledIsNotReadOutOfFlightEither()
        {
            Assert.False(SystemCapture.ReadsTheSystem(globalsPresent: true, inAGame: true, inFlight: false, flightReady: false, listed: 0, inGameState: 34));
        }

        [Fact]
        public void NothingIsReadWithNoGameLoadedOrBeforeTheGamesGlobalsExist()
        {
            Assert.False(SystemCapture.ReadsTheSystem(globalsPresent: true, inAGame: false, inFlight: false, flightReady: false, listed: 0, inGameState: null));
            Assert.False(SystemCapture.ReadsTheSystem(globalsPresent: false, inAGame: true, inFlight: false, flightReady: false, listed: 0, inGameState: 0));
            Assert.False(SystemCapture.ReadsTheSystem(globalsPresent: false, inAGame: true, inFlight: true, flightReady: true, listed: 3, inGameState: 3));
        }

        [Fact]
        public void TheActiveVesselIsReadInFlightAlone()
        {
            Assert.True(SystemCapture.ReadsTheActiveVessel(globalsPresent: true, flightReady: true));
            Assert.False(SystemCapture.ReadsTheActiveVessel(globalsPresent: true, flightReady: false));
            Assert.False(SystemCapture.ReadsTheActiveVessel(globalsPresent: false, flightReady: true));
        }
    }
}
