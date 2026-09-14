using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using Xunit;

namespace Sitrep.Core.Tests
{
    /// <summary>
    /// Where the Uplinks are on disk, and what <c>Gonogo.sln</c> says they are.
    ///
    /// <para>Shared by the coverage gates that walk Uplink SOURCE rather than
    /// loaded assemblies. No project in this repo may reference every Uplink (see
    /// <c>UplinkIsolationTests</c>), and one loading them from <c>bin/</c> is green
    /// whenever they have not been built, so a walk is the only shape a
    /// cross-Uplink gate can take here. Extracted once a second gate needed the
    /// same discovery: two copies of a walk are two chances for one of them to
    /// stop finding its subjects, and a walk that finds nothing reports a clean
    /// repo.</para>
    ///
    /// <para><b>Why a plant and not a floor.</b> Every mod Uplink is leaving for
    /// the gonogo-uplinks repo, so the honest count here is heading for zero, and
    /// a floor on it cannot tell "all moved" from "the walk broke". So the walk is
    /// also run over <see cref="PlantRoot"/>, a fixture tree under this test
    /// project holding one Uplink, one Tests sibling, a contract-slice decoy and a
    /// solution declaring all three, reached from the same resolved <c>mod/</c>.
    /// A walk pointed at the wrong directory, a name predicate that stopped
    /// matching, or a solution parse that reads nothing loses the plant, at any
    /// number of real Uplinks including none.</para>
    /// </summary>
    internal static class UplinkProjects
    {
        /// <summary>The planted Uplink <see cref="Discover(string)"/> must find under <see cref="PlantRoot"/>.</summary>
        public const string PlantedUplink = "GonogoPlantedUplink";

        /// <summary>The planted Tests sibling <see cref="DiscoverTests(string)"/> must find.</summary>
        public const string PlantedUplinkTests = PlantedUplink + ".Tests";

        /// <summary>Uplink project name -&gt; its source directory, in this repo's <c>mod/</c>.</summary>
        public static Dictionary<string, string> Discover() => Discover(ResolveModDir());

        /// <summary>Uplink project name -&gt; its source directory. The
        /// <c>.Contract</c> and <c>.Tests</c> siblings are not Uplinks.</summary>
        public static Dictionary<string, string> Discover(string root) => Walk(root, "Uplink");

        /// <summary><c>&lt;Uplink&gt;.Tests</c> project name -&gt; its source directory, in this repo's <c>mod/</c>.</summary>
        public static Dictionary<string, string> DiscoverTests() => DiscoverTests(ResolveModDir());

        /// <summary>
        /// <c>&lt;Uplink&gt;.Tests</c> project name -&gt; its source directory. The
        /// <c>.Contract.Codegen</c> siblings do not match and neither do the plain
        /// Uplink directories.
        /// </summary>
        public static Dictionary<string, string> DiscoverTests(string root) => Walk(root, "Uplink.Tests");

        /// <summary>
        /// The Uplink projects the <c>Gonogo.sln</c> in <paramref name="root"/>
        /// declares: the independent source a directory walk is checked against.
        /// </summary>
        public static HashSet<string> DeclaredInSolution(string root) =>
            Declared(root, @"=\s*""([A-Za-z0-9_.]+Uplink)""");

        /// <summary>
        /// The <c>&lt;Uplink&gt;.Tests</c> projects the <c>Gonogo.sln</c> in
        /// <paramref name="root"/> declares. The two patterns do not overlap: that
        /// one anchors on <c>Uplink"</c>, this one on <c>Uplink.Tests"</c>.
        /// </summary>
        public static HashSet<string> TestsDeclaredInSolution(string root) =>
            Declared(root, @"=\s*""([A-Za-z0-9_.]+Uplink\.Tests)""");

        /// <summary>The fixture tree the walks are proved against, resolved through the same <c>mod/</c> they walk.</summary>
        public static string PlantRoot() =>
            Path.Combine(ResolveModDir(), "Sitrep.Core.Tests", "UplinkWalkPlant");

        /// <summary>
        /// The walk-proof both Uplink gates rest on, for either walk.
        ///
        /// <para>Three halves, none of them a count. The plant: run over
        /// <see cref="PlantRoot"/>, the walk and the solution parse each return
        /// exactly the planted project, which a broken root, predicate or parse
        /// cannot. The source: the real <c>Gonogo.sln</c> exists and declares the
        /// project running this test, so the solution compared against is the one
        /// in use and not an empty stand-in. The agreement: the real walk and the
        /// real solution name the same set in BOTH directions, which is exact and
        /// stays meaningful at zero, because the first two halves are what an
        /// empty set is then read against.</para>
        /// </summary>
        public static void AssertWalkAgreesWithPlantAndSolution(
            string kind,
            Func<string, Dictionary<string, string>> walk,
            Func<string, HashSet<string>> declared,
            string planted)
        {
            var plantRoot = PlantRoot();
            var plantWalked = walk(plantRoot).Keys.OrderBy(n => n, StringComparer.Ordinal).ToList();
            Assert.True(
                plantWalked.SequenceEqual(new[] { planted }),
                $"The {kind} walk over the fixture at {plantRoot} found [{string.Join(", ", plantWalked)}], " +
                $"expected exactly [{planted}]. Every gate reading this walk trusts it to find its " +
                "subjects, and a walk that finds nothing reports no violations and looks exactly like a " +
                "clean repo, so this plant is how a broken walk is told apart from one with nothing left to find.");

            var plantDeclared = declared(plantRoot).OrderBy(n => n, StringComparer.Ordinal).ToList();
            Assert.True(
                plantDeclared.SequenceEqual(new[] { planted }),
                $"The {kind} solution parse over the fixture's Gonogo.sln found [{string.Join(", ", plantDeclared)}], " +
                $"expected exactly [{planted}]. It is the independent source the real walk is checked " +
                "against, so a parse that reads nothing compares nothing to nothing and passes.");

            var modDir = ResolveModDir();
            var solution = File.ReadAllText(Path.Combine(modDir, "Gonogo.sln"));
            Assert.True(
                Regex.IsMatch(solution, @"=\s*""Sitrep\.Core\.Tests"""),
                $"{Path.Combine(modDir, "Gonogo.sln")} does not declare Sitrep.Core.Tests, the project running " +
                "this check, so it is not the solution this repo builds and agreeing with it proves nothing.");

            var real = walk(modDir).Keys.ToHashSet(StringComparer.Ordinal);
            var realDeclared = declared(modDir);

            var undeclared = real.Except(realDeclared).OrderBy(n => n, StringComparer.Ordinal).ToList();
            var unwalked = realDeclared.Except(real).OrderBy(n => n, StringComparer.Ordinal).ToList();
            Assert.True(
                undeclared.Count == 0 && unwalked.Count == 0,
                $"The {kind} walk and Gonogo.sln disagree. Walked but not declared: [{string.Join(", ", undeclared)}]. " +
                $"Declared but not walked: [{string.Join(", ", unwalked)}]. Either the walk is broken, or a " +
                "project was added to or removed from one of disk and solution without the other.");
        }

        /// <summary>
        /// Every directory holding one Uplink's C#, as THIS repo lays it out: the
        /// project itself and its <c>.Contract</c> sibling, which is where the
        /// command-name and topic constants usually live. The layout is stated
        /// here rather than inside the walk because the walk is shared with the
        /// repo departed Uplinks live in, which lays them out differently.
        /// </summary>
        public static IReadOnlyList<string> SourceDirectories(string directory) =>
            new[] { directory, directory + ".Contract" };

        public static string ResolveModDir()
        {
            var directory = new DirectoryInfo(AppContext.BaseDirectory);
            while (directory is not null)
            {
                var candidate = Path.Combine(directory.FullName, "mod", "Sitrep.Contract");
                if (Directory.Exists(candidate))
                {
                    return Path.Combine(directory.FullName, "mod");
                }

                directory = directory.Parent;
            }

            throw new InvalidOperationException(
                "Could not locate mod/ walking up from " + AppContext.BaseDirectory);
        }

        /// <summary>A <c>Gonogo*&lt;suffix&gt;</c> directory directly under <paramref name="root"/> holding its own csproj.</summary>
        private static Dictionary<string, string> Walk(string root, string suffix)
        {
            var projects = new Dictionary<string, string>(StringComparer.Ordinal);

            foreach (var directory in Directory.EnumerateDirectories(root))
            {
                var name = Path.GetFileName(directory);
                if (!name.StartsWith("Gonogo", StringComparison.Ordinal) ||
                    !name.EndsWith(suffix, StringComparison.Ordinal))
                {
                    continue;
                }

                if (File.Exists(Path.Combine(directory, name + ".csproj")))
                {
                    projects[name] = directory;
                }
            }

            return projects;
        }

        /// <summary>
        /// Throws rather than answering empty when the solution is missing: an
        /// absent solution is a broken walk, and an empty set is what a finished
        /// migration also looks like.
        /// </summary>
        private static HashSet<string> Declared(string root, string pattern)
        {
            var solution = Path.Combine(root, "Gonogo.sln");
            var declared = new HashSet<string>(StringComparer.Ordinal);

            foreach (Match match in Regex.Matches(File.ReadAllText(solution), pattern))
            {
                declared.Add(match.Groups[1].Value);
            }

            return declared;
        }
    }
}
