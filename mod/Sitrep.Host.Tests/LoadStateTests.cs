using Sitrep.Host;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// When a scene load starts and when its scene stands, as the game's own
    /// events tell it. A load is not a stopped clock and not a pause, so the
    /// only things that move the state are the load events and the backstop.
    /// </summary>
    public class LoadStateTests
    {
        [Fact]
        public void ARequestStartsALoadAndAFlightLoadOutlastsItsSceneStanding()
        {
            var state = new LoadState();
            state.LoadRequested("FLIGHT");
            Assert.Equal(GamePhase.Loading, state.Phase);
            Assert.Equal("FLIGHT", state.Scene);

            state.SceneStood("FLIGHT");
            Assert.Equal(GamePhase.Loading, state.Phase);

            state.FlightReady();
            Assert.Equal(GamePhase.Ready, state.Phase);
            Assert.Equal("FLIGHT", state.Scene);
        }

        [Fact]
        public void ANonFlightLoadEndsWhenItsSceneStands()
        {
            var state = new LoadState();
            state.LoadRequested("EDITOR");
            Assert.Equal(GamePhase.Loading, state.Phase);

            state.SceneStood("EDITOR");
            Assert.Equal(GamePhase.Ready, state.Phase);
        }

        [Fact]
        public void ALaterRequestReplacesTheTargetAndAStaleSceneStandingIsIgnored()
        {
            var state = new LoadState();
            state.LoadRequested("FLIGHT");
            state.LoadRequested("SPACECENTER");

            state.SceneStood("FLIGHT");
            Assert.Equal(GamePhase.Loading, state.Phase);
            Assert.Equal("SPACECENTER", state.Scene);

            state.SceneStood("SPACECENTER");
            Assert.Equal(GamePhase.Ready, state.Phase);
        }

        [Fact]
        public void AFlightReadyForARetargetedLoadIsIgnored()
        {
            var state = new LoadState();
            state.LoadRequested("FLIGHT");
            state.LoadRequested("SPACECENTER");

            state.FlightReady();
            Assert.Equal(GamePhase.Loading, state.Phase);
        }

        [Fact]
        public void TheMainMenuStandsAsNoGame()
        {
            var state = new LoadState();
            state.LoadRequested("MAINMENU");
            state.SceneStood("MAINMENU");

            Assert.Equal(GamePhase.NoGame, state.Phase);
        }

        [Fact]
        public void ALoadFromTheMainMenuLeavesNoGame()
        {
            var state = new LoadState();
            state.LoadRequested("MAINMENU");
            state.SceneStood("MAINMENU");

            state.LoadRequested("SPACECENTER");
            Assert.Equal(GamePhase.Loading, state.Phase);
        }

        [Fact]
        public void TheBackstopEndsALoadWhoseSceneHasBeenUpForASecondWithoutItsEvent()
        {
            var state = new LoadState();
            state.LoadRequested("FLIGHT");

            state.Watch(sceneIsUp: true, realSeconds: 10.0);
            state.Watch(sceneIsUp: true, realSeconds: 10.9);
            Assert.Equal(GamePhase.Loading, state.Phase);

            state.Watch(sceneIsUp: true, realSeconds: 11.0);
            Assert.Equal(GamePhase.Ready, state.Phase);
            Assert.True(state.EndedWithoutItsEvent);
        }

        [Fact]
        public void TheBackstopStartsAgainWhenTheSceneIsNotUpForAFrame()
        {
            var state = new LoadState();
            state.LoadRequested("FLIGHT");

            state.Watch(true, 10.0);
            state.Watch(false, 10.5);
            state.Watch(true, 10.6);
            state.Watch(true, 11.2);

            Assert.Equal(GamePhase.Loading, state.Phase);
        }

        [Fact]
        public void TheBackstopLeavesAnEndedLoadAloneAndItsEventClearsTheFlag()
        {
            var state = new LoadState();
            state.LoadRequested("EDITOR");
            state.SceneStood("EDITOR");

            state.Watch(true, 10.0);
            state.Watch(true, 12.0);

            Assert.Equal(GamePhase.Ready, state.Phase);
            Assert.False(state.EndedWithoutItsEvent);
        }

        [Fact]
        public void AMenuLoadBackstopEndsAsNoGame()
        {
            var state = new LoadState();
            state.LoadRequested("MAINMENU");

            state.Watch(true, 5.0);
            state.Watch(true, 6.0);

            Assert.Equal(GamePhase.NoGame, state.Phase);
        }

        [Fact]
        public void PausingAndAStoppedClockChangeNothingBecauseNeitherIsAnEvent()
        {
            var state = new LoadState();
            state.LoadRequested("EDITOR");
            state.SceneStood("EDITOR");

            var changes = 0;
            state.Changed += () => changes++;
            for (var i = 0; i < 10; i++)
            {
                state.Watch(true, 20.0 + i);
            }

            Assert.Equal(0, changes);
        }

        [Fact]
        public void EveryChangeIsAnnouncedOnceAndARepeatIsNot()
        {
            var state = new LoadState();
            var changes = 0;
            state.Changed += () => changes++;

            state.LoadRequested("FLIGHT");
            state.LoadRequested("FLIGHT");
            state.FlightReady();
            state.FlightReady();

            Assert.Equal(2, changes);
        }

        [Fact]
        public void SeedingNamesTheSceneTheModStartedIn()
        {
            var menu = new LoadState();
            menu.Seed("MAINMENU");
            Assert.Equal(GamePhase.NoGame, menu.Phase);

            var boot = new LoadState();
            boot.Seed("LOADING");
            Assert.Equal(GamePhase.Loading, boot.Phase);

            var flight = new LoadState();
            flight.Seed("FLIGHT");
            Assert.Equal(GamePhase.Ready, flight.Phase);
        }
    }
}
