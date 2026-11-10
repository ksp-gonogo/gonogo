using System;
using System.Linq;
using System.Reflection;
using Gonogo.KSP.Tests.CurrencyDelay;
using Xunit;

namespace Gonogo.KSP.Tests
{
    /// <summary>
    /// The Rename Vessel dialog is reached from the command part's menu, so the
    /// window mirror claims it through the part event that opens it. The event
    /// is read off <c>Assembly-CSharp.dll</c> and the claim path off the shipped
    /// source, because the capture reaches Unity canvases and none of it runs
    /// headlessly.
    /// </summary>
    public class GameWindowOpenerTests
    {
        [Fact]
        public void RenameVesselIsAPartMenuEventOnTheCommandModule()
        {
            var method = typeof(ModuleCommand).GetMethod("RenameVessel", BindingFlags.Public | BindingFlags.Instance);

            Assert.NotNull(method);
            var attribute = method!.GetCustomAttributes(typeof(KSPEvent), false).Cast<KSPEvent>().SingleOrDefault();
            Assert.NotNull(attribute);
            Assert.True(attribute!.guiActive, "the button must be on the flight part menu for the mirror's watch to see it fire");
        }

        [Fact]
        public void AFiringPartEventStartsTheWatchThatClaimsTheNextDialog()
        {
            var opener = CurrencyDelaySourceText.ReadRelative("GameWindows/OpenerWatch.cs");

            Assert.Contains("typeof(BaseEvent)", opener);
            Assert.Contains("nameof(InvokePrefix)", opener);
            Assert.Contains("UguiCapture.SnapshotCanvases()", opener);
        }

        [Fact]
        public void TheWindowsChannelIsDelayedAndStampedWithTheCapturesOwnTime()
        {
            var uplink = CurrencyDelaySourceText.ReadRelative("GameWindows/GameWindowsUplink.cs");

            Assert.Contains("Delay = DelayRole.Delayed", uplink);
            Assert.Contains("_windows.Publish(frame.Payload, frame.Ut)", uplink);
            Assert.DoesNotContain("DelayRole.TrueNow", uplink);
        }

        [Fact]
        public void TheDialogCanvasTheRenameDialogSpawnsOnIsWatched()
        {
            var capture = CurrencyDelaySourceText.ReadRelative("GameWindows/UguiCapture.cs");
            var canvases = CurrencyDelaySourceText.MethodBody(capture, "private static IEnumerable<Transform> Canvases()");

            Assert.Contains("ui.dialogCanvas", canvases);
            Assert.Contains("OpenerWatch.Claim()", capture);
        }
    }
}
