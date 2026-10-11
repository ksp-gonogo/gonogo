using System;
using System.Text.RegularExpressions;
using Gonogo.KSP.Tests.CurrencyDelay;
using Xunit;

namespace Gonogo.KSP.Tests.Localisation
{
    /// <summary>
    /// That nothing which names a craft to an operator reads its raw stored
    /// name. A stock craft stores a localisation tag there, so a raw read puts
    /// the tag on the roster, the pad title and the crash and recovery reports.
    /// These files need a live scene, so the wiring is reachable only as source
    /// text; the helper itself is covered by <c>GameNameTests</c>.
    /// </summary>
    public class KspHostVesselNameIsLocalisedTests
    {
        [Theory]
        [InlineData("KspHost.cs")]
        [InlineData("CrashUplink.cs")]
        [InlineData("RecoveryUplink.cs")]
        public void no_raw_vesselName_read_remains(string file)
        {
            var source = CurrencyDelaySourceText.ReadRelative(file);

            var raw = Regex.Matches(source, @"(?<!VesselName\()\b(?:vessel|proto|protoVessel|v)\??\.vesselName\b(?!\s*=[^=])");
            var lines = new System.Collections.Generic.List<string>();
            foreach (Match m in raw)
            {
                var line = 1 + source.Substring(0, m.Index).Split('\n').Length - 1;
                lines.Add("line " + line);
            }

            Assert.True(lines.Count == 0, "raw vesselName read in " + file + ", route it through GameWords.VesselName: " + string.Join(", ", lines));
        }

        [Fact]
        public void the_scan_sees_a_planted_raw_read()
        {
            var planted = "[\"name\"] = vessel.vesselName,";

            Assert.Matches(@"(?<!VesselName\()\b(?:vessel|proto|protoVessel|v)\??\.vesselName\b(?!\s*=[^=])", planted);
        }
    }
}
