using System.Collections.Generic;
using System.Linq;
using Gonogo.KSP.GameWindows;
using Gonogo.KSP.Tests.CurrencyDelay;
using Sitrep.Contract;
using Xunit;

namespace Gonogo.KSP.Tests
{
    /// <summary>
    /// A mirrored window is shown only to the session whose press opened it, and
    /// only a press can open one.
    /// </summary>
    public class GameWindowAudienceTests
    {
        private static Dictionary<string, object?> Window(string id, string session, string pressId = "r1") =>
            new Dictionary<string, object?>
            {
                ["id"] = id,
                ["openedBy"] = new WindowOpenedBy { PartId = "7", Event = "Rename", Session = session, PressId = pressId }.ToWire(),
            };

        private static Dictionary<string, object?> Frame(params Dictionary<string, object?>[] windows) =>
            new Dictionary<string, object?> { ["windows"] = windows.Select(w => (object?)w).ToList() };

        private static List<Dictionary<string, object?>> Seen(object? filtered) =>
            ((List<object?>)((Dictionary<string, object?>)filtered!)["windows"]!).Cast<Dictionary<string, object?>>().ToList();

        [Fact]
        public void ASessionIsShownTheWindowsItsOwnPressOpenedAndNoOthers()
        {
            var frame = Frame(Window("a", "session-1"), Window("b", "session-2"));

            var first = Seen(WindowAudience.KeepPressedBy(frame, new ViewerContext("ground:gs", "session-1")));
            var second = Seen(WindowAudience.KeepPressedBy(frame, new ViewerContext("ground:gs", "session-2")));
            var third = Seen(WindowAudience.KeepPressedBy(frame, new ViewerContext("ground:gs", "session-3")));

            Assert.Equal(new[] { "a" }, first.Select(w => (string)w["id"]!));
            Assert.Equal(new[] { "b" }, second.Select(w => (string)w["id"]!));
            Assert.Empty(third);
        }

        [Fact]
        public void TheSessionIdIsNotPassedOnButThePressIdIs()
        {
            var seen = Seen(WindowAudience.KeepPressedBy(Frame(Window("a", "session-1", "req-9")), new ViewerContext("v", "session-1")));

            var opener = (Dictionary<string, object?>)seen.Single()["openedBy"]!;
            Assert.False(opener.ContainsKey("session"));
            Assert.Equal("req-9", opener["pressId"]);
        }

        [Fact]
        public void AWindowNoPressOpenedIsShownToNoSession()
        {
            var unpressed = new Dictionary<string, object?> { ["id"] = "x", ["openedBy"] = null };

            Assert.Empty(Seen(WindowAudience.KeepPressedBy(Frame(unpressed, Window("blank", "")), new ViewerContext("v", "session-1"))));
        }

        [Fact]
        public void AFrameOfAnUnexpectedShapeIsWithheldRatherThanShownToEveryone()
        {
            Assert.Null(WindowAudience.KeepPressedBy("not a frame", new ViewerContext("v", "session-1")));
        }

        [Fact]
        public void OnlyAPressSentFromAScreenStartsTheWatchForAWindow()
        {
            var opener = CurrencyDelaySourceText.ReadRelative("GameWindows/OpenerWatch.cs");
            var prefix = CurrencyDelaySourceText.MethodBody(opener, "public static void InvokePrefix(BaseEvent __instance)");
            var vessel = CurrencyDelaySourceText.ReadRelative("VesselUplink.cs");
            var uplink = CurrencyDelaySourceText.ReadRelative("GameWindows/GameWindowsUplink.cs");

            Assert.StartsWith("if (_press == null) return;", prefix.TrimStart().TrimStart('{').TrimStart());
            Assert.Contains("OpenerWatch.Pressing(origin)", vessel);
            Assert.Contains("OpenerWatch.Pressing(origin)", uplink);
            Assert.Contains("ViewerFilter = WindowAudience.KeepPressedBy", uplink);
        }

        [Fact]
        public void AStockDialogIsHiddenOnlyOnceAPressHasClaimedIt()
        {
            var capture = CurrencyDelaySourceText.ReadRelative("GameWindows/UguiCapture.cs");
            var tick = CurrencyDelaySourceText.MethodBody(capture, "internal static void Tick()");
            var claim = tick.IndexOf("OpenerWatch.Claim()", System.StringComparison.Ordinal);
            var hide = tick.IndexOf("HideFromGameScreen(claimed)", System.StringComparison.Ordinal);

            Assert.True(claim >= 0 && hide > claim, "the dialog is hidden after the press claims it, never before");
            Assert.Equal(1, tick.Split(new[] { "HideFromGameScreen(" }, System.StringSplitOptions.None).Length - 1);
            Assert.Contains("opener == null) continue;", tick);
        }
    }
}
