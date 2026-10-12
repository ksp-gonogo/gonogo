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

        [Theory]
        [InlineData("KspHost.cs")]
        [InlineData("CrashUplink.cs")]
        [InlineData("RecoveryUplink.cs")]
        [InlineData("FlightUplink.cs")]
        [InlineData("CurrencyEventUplink.cs")]
        [InlineData("KspCareerActuator.cs")]
        public void no_stored_vessel_is_handed_to_the_overload_that_takes_a_live_one(string file)
        {
            var misuse = ProtoVesselPassedAsVessel(CurrencyDelaySourceText.ReadRelative(file));

            Assert.True(
                misuse.Count == 0,
                "GameWords.VesselName(Vessel) is called with a ProtoVessel in " + file
                    + ", which cannot bind: pass its vesselName. Lines: " + string.Join(", ", misuse));
        }

        [Fact]
        public void the_binding_scan_sees_a_planted_proto_vessel_call()
        {
            var planted = "void OnRecovered(ProtoVessel vessel, bool quick) { Name(GameWords.VesselName(vessel)); }";
            var fine = "void OnRecovered(ProtoVessel vessel, bool quick) { Name(GameWords.VesselName(vessel.vesselName)); }"
                + "\nvoid Other(Vessel vessel) { Name(GameWords.VesselName(vessel)); }";

            Assert.Single(ProtoVesselPassedAsVessel(planted));
            Assert.Empty(ProtoVesselPassedAsVessel(fine));
        }

        /// <summary>
        /// Lines where <c>GameWords.VesselName</c> is given a bare identifier whose
        /// nearest preceding declaration in the file is a <c>ProtoVessel</c>. The
        /// helper has overloads for a live vessel and for a stored name only, so
        /// such a call does not compile; this code needs a live scene and is not
        /// built by this suite, which is why it is read as text.
        /// </summary>
        private static System.Collections.Generic.List<int> ProtoVesselPassedAsVessel(string source)
        {
            var lines = new System.Collections.Generic.List<int>();
            var notTypes = new System.Collections.Generic.HashSet<string> { "return", "throw", "case", "else", "new", "await", "out", "ref", "in", "is", "as" };
            foreach (Match call in Regex.Matches(source, @"GameWords\.VesselName\(\s*(?<id>[A-Za-z_]\w*)\s*\)"))
            {
                var id = call.Groups["id"].Value;
                var before = source.Substring(0, call.Index);
                string? type = null;
                foreach (Match declaration in Regex.Matches(before, @"\b(?<type>[A-Za-z_][\w.<>?]*)\s+" + Regex.Escape(id) + @"\b(?=\s*[,)=;])"))
                {
                    var candidate = declaration.Groups["type"].Value;
                    if (!notTypes.Contains(candidate)) type = candidate;
                }
                if (type == "ProtoVessel")
                {
                    lines.Add(before.Split('\n').Length);
                }
            }
            return lines;
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
