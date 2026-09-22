using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// Every class that reaches <c>VesselViewProvider</c>'s process-wide arc
    /// resolver runs in the collection that serialises it.
    ///
    /// <para><c>_arcSource</c> and <c>_horizonSource</c> are plain statics. While
    /// one test has a resolver installed, a <c>BuildOrbit</c> anywhere else in the
    /// assembly runs through THAT test's closure, and xunit runs collections in
    /// parallel. The reader does not fail: the counter it inflates belongs to the
    /// installing test, which fails instead, and only under enough load to widen
    /// a window a few statements wide.</para>
    ///
    /// <para>The collection exists and is the right mechanism. What it cannot do
    /// is notice a class that never joined it, which is the state it was in: one
    /// member, serialising itself against nothing, while two other classes made
    /// eighteen unserialised calls.</para>
    /// </summary>
    public class VesselViewProviderStaticsCollectionTests
    {
        private const string Collection = "VesselViewProviderStatics";

        /*
         * Split either side of the parenthesis so this file is not itself a match.
         * The guard is written to apply to every file in the project including
         * this one, rather than to carry an exemption for the one file that has
         * to spell out what it is looking for.
         */
        private const string Call = "VesselViewProvider.BuildOrbit" + "(";
        private const string WireCall = "VesselViewProvider.BuildOrbitWire" + "(";
        private const string TruthCall = "VesselViewProvider.BuildOrbitTruth" + "(";

        /// <summary>
        /// Low enough to survive ordinary churn, high enough that a walk which
        /// resolved the wrong directory cannot report a clean tree. A scan with
        /// nothing to scan is indistinguishable from a scan that found nothing
        /// wrong.
        /// </summary>
        private const int FewestFilesAWorkingWalkSees = 80;

        [Fact]
        public void EveryClassThatBuildsAnOrbitJoinsTheCollectionThatSerialisesTheStatics()
        {
            var files = TestSourceFiles();
            Assert.True(
                files.Count >= FewestFilesAWorkingWalkSees,
                $"The walk saw {files.Count} source file(s), fewer than the " +
                $"{FewestFilesAWorkingWalkSees} this project has. It is looking in the " +
                "wrong place, and a clean result from it means nothing.");

            var unserialised = new List<string>();
            foreach (var file in files)
            {
                var source = File.ReadAllText(file);
                if (!ReachesTheArcResolver(source)) continue;
                if (DeclaresCollection(source)) continue;
                unserialised.Add(Path.GetFileName(file));
            }

            Assert.True(
                unserialised.Count == 0,
                $"These classes reach VesselViewProvider's process-wide arc resolver and are " +
                $"not in [Collection(\"{Collection}\")], so they run in parallel with whoever " +
                "has a resolver installed and inflate that test's counters:\n  " +
                string.Join("\n  ", unserialised));
        }

        /// <summary>
        /// The predicate is shown each thing it must tell apart before its silence
        /// is believed.
        ///
        /// <para>A substring count of <c>BuildOrbit</c> over this project reports
        /// 34 matches in a file with 15 real calls, because a doc comment
        /// explaining the routine and a test named after it both score. That count
        /// is what put the exposure at four classes when it is two, so the cases
        /// below are the four shapes that mattered.</para>
        /// </summary>
        [Theory]
        [InlineData("            var orbit = " + Call + "snapshot);", true)]
        [InlineData("            var json = " + WireCall + "Snapshot());", true)]
        [InlineData("        // The exact bug: " + Call + "snapshot) stores these as", false)]
        [InlineData("        /// class's <c>" + Call + "</c> and friends", false)]
        [InlineData("        public void BuildOrbitMapsThePatchChain()", false)]
        [InlineData("            Assert.Null(" + TruthCall + "snapshot));", false)]
        public void ThePredicateTellsACallFromAMentionOfOne(string line, bool reaches)
        {
            Assert.Equal(reaches, ReachesTheArcResolver(line));
        }

        [Fact]
        public void ThePredicateSeesTheAttributeAndItsAbsence()
        {
            Assert.True(DeclaresCollection($"    [Collection(\"{Collection}\")]"));
            Assert.False(DeclaresCollection("    [Collection(\"SystemViewProviderStatics\")]"));
            Assert.False(DeclaresCollection("    public class Whatever"));
        }

        /// <summary>
        /// A call that ends up running <c>ElementArc</c>, which has exactly one
        /// call site: inside <c>BuildOrbit</c>. <c>BuildOrbitWire</c> delegates to
        /// it; <c>BuildOrbitTruth</c> and <c>BuildOrbitTruthWire</c> do not, so a
        /// truth call is not a reach however much it looks like one.
        ///
        /// <para>Qualified on the type, so a method DECLARATION named after the
        /// routine does not match, and read from comment-stripped source, so
        /// prose about the routine does not either.</para>
        /// </summary>
        private static bool ReachesTheArcResolver(string source)
        {
            var code = WithoutComments(source);
            return code.Contains(Call, StringComparison.Ordinal) ||
                   code.Contains(WireCall, StringComparison.Ordinal);
        }

        private static bool DeclaresCollection(string source) =>
            source.Contains($"[Collection(\"{Collection}\")]", StringComparison.Ordinal);

        /// <summary>
        /// Source with <c>//</c> and <c>///</c> tails and <c>/* */</c> spans
        /// removed. Deliberately not a parser: it does not know about a
        /// <c>//</c> inside a string literal, which this project has none of on a
        /// line that also names the routine.
        /// </summary>
        private static string WithoutComments(string source)
        {
            var kept = new StringBuilder(source.Length);
            var inBlock = false;
            foreach (var raw in source.Split('\n'))
            {
                var line = raw;
                if (inBlock)
                {
                    var close = line.IndexOf("*/", StringComparison.Ordinal);
                    if (close < 0) continue;
                    line = line[(close + 2)..];
                    inBlock = false;
                }

                int open;
                while ((open = line.IndexOf("/*", StringComparison.Ordinal)) >= 0)
                {
                    var close = line.IndexOf("*/", open + 2, StringComparison.Ordinal);
                    if (close < 0)
                    {
                        inBlock = true;
                        line = line[..open];
                        break;
                    }

                    line = line[..open] + line[(close + 2)..];
                }

                var slashes = line.IndexOf("//", StringComparison.Ordinal);
                if (slashes >= 0) line = line[..slashes];

                kept.Append(line).Append('\n');
            }

            return kept.ToString();
        }

        /// <summary>This project's own <c>.cs</c> files, found by walking up to <c>mod/</c>.</summary>
        private static List<string> TestSourceFiles()
        {
            var directory = new DirectoryInfo(AppContext.BaseDirectory);
            while (directory is not null)
            {
                var candidate = Path.Combine(directory.FullName, "mod", "Sitrep.Host.Tests");
                if (Directory.Exists(candidate))
                {
                    return Directory
                        .EnumerateFiles(candidate, "*.cs", SearchOption.AllDirectories)
                        .Where(f => !f.Contains($"{Path.DirectorySeparatorChar}bin{Path.DirectorySeparatorChar}", StringComparison.Ordinal))
                        .Where(f => !f.Contains($"{Path.DirectorySeparatorChar}obj{Path.DirectorySeparatorChar}", StringComparison.Ordinal))
                        .ToList();
                }

                directory = directory.Parent;
            }

            throw new InvalidOperationException(
                "Could not locate mod/Sitrep.Host.Tests walking up from " + AppContext.BaseDirectory);
        }
    }
}
