using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Xunit;

namespace Gonogo.KSP.Tests.ActiveVessel
{
    /// <summary>
    /// The ratchet that keeps <c>ActiveVesselScope</c> being the seam. A new
    /// <c>FlightGlobals.ActiveVessel</c> read anywhere in <c>mod/Gonogo.KSP</c> is a
    /// second answer to "which vessel are we reporting", and the whole point of the
    /// seam is that there is one.
    ///
    /// <para>Reads the shipped source rather than the compiled assembly, for the
    /// same reason <c>CurrencyDelaySettlePumpIsWiredTests</c> does: most of these
    /// files need a live scene and this project cannot load them.</para>
    ///
    /// <para>The allow list is the set of reads that are deliberately NOT about
    /// telemetry scope. It is a CEILING, so removing one of them does not fail;
    /// each entry carries its reason at the call site too.</para>
    /// </summary>
    public class ActiveVesselSeamIsRoutedTests
    {
        private const string DirectRead = "FlightGlobals.ActiveVessel";

        /// <summary>
        /// Path (relative to <c>mod/Gonogo.KSP</c>) to how many direct reads that
        /// file is allowed. Reasons, in the same order:
        ///
        /// <list type="bullet">
        /// <item>the crew-loss attribution names the thing that DIED, not the thing
        /// being reported</item>
        /// <item>the clear-to-save gate only guards stock's own
        /// <c>FlightGlobals.ClearToSave()</c>, which judges KSP's active vessel</item>
        /// <item>TWO in the flight-ops actuator: the launch refusal asks whether
        /// KSP has ANY vessel left in the world and runs in scenes that have no
        /// flight, and the tracking-station exit guards the same
        /// <c>FlightGlobals.ClearToSave()</c> the gate above does, for the same
        /// reason (it judges KSP's active vessel, so asking about the reported
        /// craft would make the refusal disagree with the thing it quotes)</item>
        /// <item>the visibility calibration wants ANY propagatable orbit and falls
        /// through to the whole roster</item>
        /// </list>
        /// </summary>
        private static readonly Dictionary<string, int> Allowed = new Dictionary<string, int>
        {
            ["CurrencyEventUplink.cs"] = 1,
            ["Gates/KspGateEvaluators.cs"] = 1,
            ["KspFlightOpsActuator.cs"] = 2,
            ["SilenceTracking/KspVisibilityGeometryFactory.cs"] = 1,
        };

        [Fact]
        public void NoFileOutsideTheAllowListReadsTheActiveVesselDirectly()
        {
            var offenders = Scan()
                .Where(entry => !Allowed.ContainsKey(entry.Key))
                .Select(entry => entry.Key + " (" + entry.Value + ")")
                .OrderBy(text => text, StringComparer.Ordinal)
                .ToList();

            Assert.True(
                offenders.Count == 0,
                "These files read FlightGlobals.ActiveVessel directly instead of ActiveVesselScope.Current: " +
                string.Join(", ", offenders) +
                ". Route the read through the seam, or add the file here with the reason it is not about telemetry scope.");
        }

        [Fact]
        public void NoAllowedFileHasGrownAnotherDirectRead()
        {
            var found = Scan();

            foreach (var allowed in Allowed)
            {
                found.TryGetValue(allowed.Key, out var count);
                Assert.True(
                    count <= allowed.Value,
                    allowed.Key + " now reads FlightGlobals.ActiveVessel " + count +
                    " times, up from the allowed " + allowed.Value + ".");
            }
        }

        /// <summary>
        /// A scanner that cannot see a violation reports zero, and zero reads as
        /// success. Plant one and check it is found - and that a commented-out read,
        /// which is what most of the remaining mentions in the tree are, is not.
        /// </summary>
        [Fact]
        public void TheScanCanSeeAPlantedViolation()
        {
            const string planted = "        public void Thing()\n        {\n            var v = FlightGlobals.ActiveVessel;\n        }\n";
            const string commented = "        /// Reads <c>FlightGlobals.ActiveVessel</c>.\n            // var v = FlightGlobals.ActiveVessel;\n";

            Assert.Equal(1, CountDirectReads(planted));
            Assert.Equal(0, CountDirectReads(commented));
        }

        /// <summary>Every file under <c>mod/Gonogo.KSP</c> with at least one direct read, and how many.</summary>
        private static Dictionary<string, int> Scan()
        {
            var root = ProjectRoot();
            var found = new Dictionary<string, int>(StringComparer.Ordinal);

            foreach (var path in Directory.EnumerateFiles(root, "*.cs", SearchOption.AllDirectories))
            {
                var relative = path.Substring(root.Length).TrimStart(Path.DirectorySeparatorChar).Replace('\\', '/');
                if (relative.StartsWith("bin/", StringComparison.Ordinal) ||
                    relative.StartsWith("obj/", StringComparison.Ordinal))
                {
                    continue;
                }

                var count = CountDirectReads(File.ReadAllText(path));
                if (count > 0)
                {
                    found[relative] = count;
                }
            }

            return found;
        }

        /// <summary>
        /// Reads on CODE lines only. A doc comment naming the stock property is
        /// prose about KSP, not a second answer to the scoping question.
        /// </summary>
        private static int CountDirectReads(string source) =>
            source.Split('\n')
                .Where(line => !line.TrimStart().StartsWith("//", StringComparison.Ordinal))
                .Count(line => line.Contains(DirectRead));

        private static string ProjectRoot()
        {
            var dir = new DirectoryInfo(AppContext.BaseDirectory);
            while (dir != null)
            {
                var candidate = Path.Combine(dir.FullName, "mod", "Gonogo.KSP");
                if (Directory.Exists(candidate))
                {
                    return candidate;
                }
                dir = dir.Parent;
            }

            throw new DirectoryNotFoundException(
                "Could not locate mod/Gonogo.KSP from " + AppContext.BaseDirectory);
        }
    }
}
