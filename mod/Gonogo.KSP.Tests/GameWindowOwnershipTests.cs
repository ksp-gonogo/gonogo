using Gonogo.KSP.GameWindows;
using Gonogo.KSP.Tests.CurrencyDelay;
using Xunit;

namespace Gonogo.KSP.Tests
{
    /// <summary>
    /// A hidden window goes back to the game's own screen once the session it was
    /// opened for has gone, and a repeat press hands the window to the new press.
    /// </summary>
    public class GameWindowOwnershipTests
    {
        [Fact]
        public void AWindowStaysHiddenWhileItsSessionIsReadingIt()
        {
            var ownership = new WindowOwnership(now: 0);

            Assert.False(ownership.ShouldRelease(1, connected: true, subscribed: true));
            Assert.False(ownership.ShouldRelease(500, connected: true, subscribed: true));
        }

        [Fact]
        public void AWindowIsShownAgainWhenItsSessionDisconnects()
        {
            var ownership = new WindowOwnership(0);
            ownership.ShouldRelease(1, connected: true, subscribed: true);

            Assert.True(ownership.ShouldRelease(2, connected: false, subscribed: false));
        }

        [Fact]
        public void AWindowIsShownAgainOnceItsSessionHasNotBeenReadingTheTopicForTheGrace()
        {
            var ownership = new WindowOwnership(0);
            ownership.ShouldRelease(1, connected: true, subscribed: true);

            Assert.False(ownership.ShouldRelease(2, connected: true, subscribed: false));
            Assert.True(ownership.ShouldRelease(1 + WindowOwnership.SubscribeGraceSeconds, connected: true, subscribed: false));
        }

        [Fact]
        public void AReaderThatUnsubscribesAndSubscribesAgainDoesNotLoseTheWindow()
        {
            var ownership = new WindowOwnership(0);
            ownership.ShouldRelease(1, connected: true, subscribed: true);

            // The screen redraws around its reader, which lets go of the topic and takes it again.
            Assert.False(ownership.ShouldRelease(1.5, connected: true, subscribed: false));
            Assert.False(ownership.ShouldRelease(2, connected: true, subscribed: true));

            // A second gap is counted from the last time it was reading, not from the first.
            Assert.False(ownership.ShouldRelease(2.5, connected: true, subscribed: false));
            Assert.False(ownership.ShouldRelease(2 + WindowOwnership.SubscribeGraceSeconds - 0.1, connected: true, subscribed: false));
            Assert.True(ownership.ShouldRelease(2 + WindowOwnership.SubscribeGraceSeconds, connected: true, subscribed: false));
        }

        [Fact]
        public void ASessionHasAGraceToSubscribeAndThenTheWindowIsShownAgain()
        {
            var ownership = new WindowOwnership(10);

            Assert.False(ownership.ShouldRelease(10 + WindowOwnership.SubscribeGraceSeconds - 0.1, connected: true, subscribed: false));
            Assert.True(ownership.ShouldRelease(10 + WindowOwnership.SubscribeGraceSeconds, connected: true, subscribed: false));
        }

        [Fact]
        public void ARepeatPressStartsTheWaitForItsSessionAgain()
        {
            var ownership = new WindowOwnership(0);
            ownership.ShouldRelease(1, connected: true, subscribed: true);
            ownership.Rebind(now: 100);

            Assert.False(ownership.ShouldRelease(101, connected: true, subscribed: false));
            Assert.True(ownership.ShouldRelease(100 + WindowOwnership.SubscribeGraceSeconds, connected: true, subscribed: false));
        }

        [Fact]
        public void ARepeatPressOfATrackedWindowTakesItOverAndHidesItAgain()
        {
            var capture = CurrencyDelaySourceText.ReadRelative("GameWindows/UguiCapture.cs");
            var tick = CurrencyDelaySourceText.MethodBody(capture, "internal static void Tick()");
            var rebind = CurrencyDelaySourceText.MethodBody(capture, "private static void RebindTrackedWindow()");

            Assert.Contains("RebindTrackedWindow()", tick);
            Assert.Contains("window.OpenedBy = claimed;", rebind);
            Assert.Contains("window.Ownership.Rebind(", rebind);
            Assert.Contains("HideFromGameScreen(window)", rebind);
        }

        [Fact]
        public void AWindowIsReleasedThroughTheHostsSessionDirectory()
        {
            var capture = CurrencyDelaySourceText.ReadRelative("GameWindows/UguiCapture.cs");
            var release = CurrencyDelaySourceText.MethodBody(capture, "private static void ReleaseIfUnowned(Tracked window)");
            var uplink = CurrencyDelaySourceText.ReadRelative("GameWindows/GameWindowsUplink.cs");

            Assert.Contains("Sessions.IsSessionConnected(", release);
            Assert.Contains("Sessions.IsSessionSubscribed(", release);
            Assert.Contains("group.alpha = 1f;", release);
            Assert.DoesNotContain("Destroy", release);
            Assert.Contains("host as ISessionDirectory", uplink);
        }
    }
}
