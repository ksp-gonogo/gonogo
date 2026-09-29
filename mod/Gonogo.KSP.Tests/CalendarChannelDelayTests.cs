using System;
using System.Collections.Generic;
using System.IO;
using System.Text.RegularExpressions;
using Xunit;

namespace Gonogo.KSP.Tests
{
    /// <summary>
    /// Holds <c>time.calendar</c> off the delay clock. The engine's side is
    /// covered in <c>RevealGateTests</c> (a TrueNow channel flows through a
    /// frozen link); what no test can enter is <c>VesselUplink</c>'s own
    /// declaration, which needs KSP to compile, so the guard reads its source.
    ///
    /// <para>Delayed, the calendar froze whenever the active vessel had no link,
    /// and with no vessel at all the comms backend reports none, so at the Space
    /// Center it never published and the app formatted every UT with the stock
    /// six-hour day on an RSS install.</para>
    /// </summary>
    public class CalendarChannelDelayTests
    {
        [Fact]
        public void TheCalendarIsDeclaredTrueNow()
        {
            var source = ReadVesselUplinkSource();
            var declaration = Regex.Match(source, @"\bChannel\(VesselViewProvider\.CalendarTopic\b");
            Assert.True(declaration.Success,
                "VesselUplink.cs no longer declares time.calendar through Channel(VesselViewProvider.CalendarTopic, ...): "
                + "this guard can no longer see what it checks");

            var helperStart = source.LastIndexOf("private static ChannelDeclaration ", declaration.Index, StringComparison.Ordinal);
            var helperEnd = helperStart < 0 ? -1 : source.IndexOf("\n        }", helperStart, StringComparison.Ordinal);
            var insideHelper = helperStart >= 0 && helperEnd > declaration.Index;
            Assert.True(insideHelper,
                "time.calendar is declared straight into VesselUplink's channel list, where the shared Channel() helper "
                + "makes it Delayed. The calendar is a fact about the game, not a craft: Delayed, it never publishes at the "
                + "Space Center, where there is no vessel and so no link.");

            var helper = source.Substring(helperStart, helperEnd - helperStart);
            Assert.True(Regex.IsMatch(helper, @"Delay\s*=\s*DelayRole\.TrueNow"),
                "the helper that declares time.calendar does not set Delay = DelayRole.TrueNow, so the channel rides the "
                + "delay clock and never publishes with no vessel");
            Assert.Contains("recordable: false", helper);

            var helperName = Regex.Match(helper, @"ChannelDeclaration (\w+)\(\)").Groups[1].Value;
            Assert.True(Regex.IsMatch(source, @"^\s*" + helperName + @"\(\),", RegexOptions.Multiline),
                helperName + "() is not in VesselUplink's channel list, so time.calendar is not declared at all");
        }

        /// <summary>
        /// VesselUplink.cs, found by walking up from the test binary. The walk
        /// fails loudly rather than skipping: a source guard that cannot find its
        /// source has not checked anything.
        /// </summary>
        private static string ReadVesselUplinkSource()
        {
            var dir = new DirectoryInfo(AppContext.BaseDirectory);
            var searched = new List<string>();
            while (dir != null)
            {
                var candidate = Path.Combine(dir.FullName, "mod", "Gonogo.KSP", "VesselUplink.cs");
                searched.Add(candidate);
                if (File.Exists(candidate))
                {
                    return File.ReadAllText(candidate);
                }
                dir = dir.Parent;
            }

            throw new FileNotFoundException(
                "VesselUplink.cs not found walking up from " + AppContext.BaseDirectory
                + ". Looked at: " + string.Join(", ", searched));
        }
    }
}
