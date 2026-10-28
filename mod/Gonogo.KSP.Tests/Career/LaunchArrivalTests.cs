using Gonogo.KSP;
using Xunit;

namespace Gonogo.KSP.Tests.Career
{
    /// <summary>
    /// A launch is followed from the load being started: each scene change is
    /// logged once, a vessel active in flight ends it as arrived, and running
    /// out of time ends it naming the scene the game is stuck in.
    /// </summary>
    public sealed class LaunchArrivalTests
    {
        [Fact]
        public void ASceneIsLoggedOnceAndAgainWhenItChanges()
        {
            var arrival = new LaunchArrival(60);

            arrival.Observe(0.1, "SPACECENTER", false, out var first);
            arrival.Observe(0.2, "SPACECENTER", false, out var same);
            arrival.Observe(3.0, "LOADING", false, out var changed);

            Assert.Equal("launch at 0.1 s: scene SPACECENTER, no active vessel yet", first);
            Assert.Null(same);
            Assert.Equal("launch at 3.0 s: scene LOADING, no active vessel yet", changed);
        }

        [Fact]
        public void AnActiveVesselInFlightEndsTheLaunchAsArrived()
        {
            var arrival = new LaunchArrival(60);

            var state = arrival.Observe(9.5, "FLIGHT", true, out var line);

            Assert.Equal(LaunchArrivalState.Arrived, state);
            Assert.Equal("launch reached FLIGHT with the vessel active after 9.5 s", line);
        }

        [Fact]
        public void RunningOutOfTimeNamesTheSceneTheGameIsStuckIn()
        {
            var arrival = new LaunchArrival(60);

            var state = arrival.Observe(60.0, "SPACECENTER", false, out var line);

            Assert.Equal(LaunchArrivalState.TimedOut, state);
            Assert.Equal(
                "launch did not reach flight within 60.0 s: the game is in SPACECENTER with no active vessel",
                line);
        }

        [Fact]
        public void FlightWithNoActiveVesselYetKeepsWaiting()
        {
            var arrival = new LaunchArrival(60);

            Assert.Equal(LaunchArrivalState.Waiting, arrival.Observe(5.0, "FLIGHT", false, out _));
        }
    }
}
