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
        [InlineData("FlightUplink.cs")]
        [InlineData("CurrencyEventUplink.cs")]
        [InlineData("KspCareerActuator.cs")]
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
        public void no_vessel_is_named_on_the_wire_by_its_raw_GetName()
        {
            var source = CurrencyDelaySourceText.ReadRelative("KspHost.cs");

            Assert.DoesNotMatch(@"\[""name""\]\s*=\s*(?:v|vessel|target)\.GetName\(\)", source);
        }

        [Fact]
        public void the_recovery_location_is_read_through_the_localiser()
        {
            var source = CurrencyDelaySourceText.ReadRelative("RecoveryUplink.cs");

            Assert.DoesNotMatch(RawLocationRead, source);
        }

        [Fact]
        public void the_crash_subject_is_read_through_the_localiser()
        {
            var source = CurrencyDelaySourceText.ReadRelative("CrashUplink.cs");

            Assert.DoesNotMatch(RawCrashSubjectRead, source);
        }

        [Fact]
        public void the_scan_sees_a_planted_raw_location_and_subject()
        {
            Assert.Matches(RawLocationRead, "var location = string.IsNullOrEmpty(vessel.displaylandedAt) ? vessel.landedAt : vessel.displaylandedAt;");
            Assert.Matches(RawCrashSubjectRead, "What = report?.other ?? \"\",");
        }

        private const string RawLocationRead = @"var location = (?!GameWords\.Text\()";
        private const string RawCrashSubjectRead = @"(?<!GameWords\.Text\()report\??\.other\b";

        [Fact]
        public void the_scan_sees_a_planted_raw_read()
        {
            var planted = "[\"name\"] = vessel.vesselName,";

            Assert.Matches(@"(?<!VesselName\()\b(?:vessel|proto|protoVessel|v)\??\.vesselName\b(?!\s*=[^=])", planted);
        }
    }
}
