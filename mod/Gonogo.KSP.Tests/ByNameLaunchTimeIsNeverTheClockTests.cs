using System;
using Gonogo.KSP.Tests.CurrencyDelay;
using Xunit;

namespace Gonogo.KSP.Tests
{
    /// <summary>
    /// A craft whose name matches a vessel still on its pad must not read as launched at the
    /// current time. Read as source for the same reason <c>SandboxRecoveryIsWiredTests</c> is:
    /// the vessels come from the live save.
    /// </summary>
    public class ByNameLaunchTimeIsNeverTheClockTests
    {
        [Fact]
        public void a_vessel_on_its_pad_gives_the_by_name_lookup_no_time()
        {
            var source = CurrencyDelaySourceText.ReadRelative("KspHost.cs");
            var body = CurrencyDelaySourceText.MethodBody(source, "private static List<object?> WithLastLaunched(List<object?> scanned)");

            Assert.Contains("CraftLaunchLog.VesselLaunchTime(proto.situation == Vessel.Situations.PRELAUNCH, proto.launchTime)", body, StringComparison.Ordinal);
            Assert.DoesNotContain("proto.launchTime));", body, StringComparison.Ordinal);
        }
    }
}
