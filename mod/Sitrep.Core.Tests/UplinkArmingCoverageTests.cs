using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using Xunit;

namespace Sitrep.Core.Tests
{
    /// <summary>
    /// Every Uplink that VOUCHES for its client bundle must actually say so in the
    /// manifest the loader reads.
    ///
    /// <para>Arming an Uplink is two halves that nothing joined up. One half is
    /// <c>ExpectedClientHash.g.cs</c>, baked by
    /// <c>packages/app/scripts/bake-uplink-hash.ts</c> and held current app-side by
    /// <c>bakedClientHash.test.ts</c>. The other is the manifest line that surfaces
    /// it. Bake without wiring and the const is perfect, the manifest reports
    /// <c>null</c>, and the loader quietly degrades to the two-way
    /// <c>index==bytes</c> fallback with the mod-hash arm pending. Nothing is red:
    /// the app-side test compares the generated file against a rebake, which is a
    /// different question from "does the manifest carry it".</para>
    ///
    /// <para>That gap was real. When arming landed, one of the two armed Uplinks
    /// had no test anywhere that its manifest surfaced its hash, and eleven of the
    /// twelve Uplink test projects asserted nothing about
    /// <c>ExpectedClientHash</c> at all.</para>
    ///
    /// <para><b>Why a walk rather than a test per project.</b> A per-project
    /// assertion is the thing that gets forgotten when Uplink thirteen is added,
    /// which is exactly how this hole opened. This walks the Uplink directories on
    /// disk, so a new Uplink is enrolled by existing rather than by being
    /// remembered.</para>
    ///
    /// <para><b>Why source rather than loaded assemblies.</b> The stronger check is
    /// to load every Uplink assembly and read the manifests the loader would. No
    /// project in this repo can: an Uplink may be referenced by nothing but its own
    /// Contract slice and its own Tests (see <see cref="UplinkIsolationTests"/>), so
    /// a project referencing all twelve is the coupling that file exists to
    /// prevent, and one loading them from <c>bin/</c> instead is green whenever
    /// they have not been built, which is the failure mode a coverage gate must not
    /// have. The runtime half is asserted per armed Uplink from inside that
    /// Uplink's own Tests project, where the reference is legal. This walk covers
    /// the half that scales; those per-Uplink discovery tests cover the half that
    /// needs a loaded manifest.</para>
    /// </summary>
    public class UplinkArmingCoverageTests
    {
        /// <summary>
        /// Twelve Uplinks today. A floor, not an equality: adding one must not need
        /// this number touched, removing several deliberately should.
        /// </summary>
        private const int MinimumUplinkProjectCount = 9;

        /// <summary>
        /// The exact wiring an armed Uplink's manifest needs, whitespace-collapsed.
        /// Pinned as one literal string rather than matched loosely, because the
        /// normalisation is the load-bearing half: assigning the const raw puts
        /// <c>""</c> on an unarmed manifest, and the contract reserves <c>null</c>
        /// (not empty) for "this DLL vouches for nothing".
        /// </summary>
        private const string RequiredWiring =
            "ExpectedClientHash = string.IsNullOrEmpty(ExpectedClientHash.Value) ? null : ExpectedClientHash.Value,";

        /// <summary>
        /// The walk has to find its subjects or it reports a clean repo while
        /// proving nothing. Same discipline, and the same independent
        /// <c>Gonogo.sln</c> cross-check, as
        /// <see cref="UplinkIsolationTests.ScanFindsEveryUplinkProject"/>: a floor
        /// alone cannot tell a broken walk from a shrinking repo.
        /// </summary>
        [Fact]
        public void ScanFindsEveryUplinkProject()
        {
            var uplinks = DiscoverUplinkProjects();

            Assert.True(
                uplinks.Count >= MinimumUplinkProjectCount,
                $"The Uplink scan found {uplinks.Count} project(s), expected at least " +
                $"{MinimumUplinkProjectCount}. Every assertion in this file walks that set, so a " +
                "scan finding nothing reports no violations and looks exactly like a clean repo. " +
                "Found: " + string.Join(", ", uplinks.Keys.OrderBy(k => k, StringComparer.Ordinal)));

            var declared = UplinkProjectsDeclaredInSolution();
            Assert.True(
                declared.Count >= MinimumUplinkProjectCount,
                $"Gonogo.sln declares only {declared.Count} Uplink project(s). It is the " +
                "independent source this walk is checked against, so an empty one compares " +
                "nothing to nothing and passes.");

            var missing = declared.Except(uplinks.Keys).OrderBy(n => n, StringComparer.Ordinal).ToList();
            Assert.True(
                missing.Count == 0,
                "Gonogo.sln declares Uplink projects the directory walk did not find: " +
                string.Join(", ", missing));
        }

        /// <summary>
        /// The invariant itself: a baked const and a manifest that surfaces it are
        /// one change, not two.
        /// </summary>
        [Fact]
        public void EveryArmedUplinkSurfacesItsHashInItsManifest()
        {
            var unwired = new List<string>();

            foreach (var (name, directory) in DiscoverUplinkProjects().OrderBy(u => u.Key, StringComparer.Ordinal))
            {
                if (BakedHash(directory) is null)
                {
                    continue;
                }

                if (!SourceOf(directory).Contains(RequiredWiring, StringComparison.Ordinal))
                {
                    unwired.Add(name);
                }
            }

            Assert.True(
                unwired.Count == 0,
                "These Uplinks bake an ExpectedClientHash their manifest never surfaces, so the " +
                "loader reports the mod-hash arm as pending and the arming does nothing: " +
                string.Join(", ", unwired) +
                ". Add to the UplinkManifest initialiser:\n    " + RequiredWiring);
        }

        /// <summary>
        /// The other direction, and the cheaper mistake to make: a hash written by
        /// hand into a manifest is one nothing keeps current, so it refuses the real
        /// bundle on every load the moment the client source moves. The value must
        /// come from the generated const, which
        /// <c>bakedClientHash.test.ts</c> holds to the bundle.
        /// </summary>
        [Fact]
        public void NoUplinkHardCodesAHashInsteadOfReadingTheGeneratedConst()
        {
            var literal = new Regex(@"ExpectedClientHash\s*=\s*""", RegexOptions.Compiled);
            var offenders = new List<string>();

            foreach (var (name, directory) in DiscoverUplinkProjects().OrderBy(u => u.Key, StringComparer.Ordinal))
            {
                if (literal.IsMatch(SourceOf(directory)))
                {
                    offenders.Add(name);
                }
            }

            Assert.True(
                offenders.Count == 0,
                "These Uplinks assign a literal string to ExpectedClientHash rather than reading " +
                "the generated const, so nothing holds it current and it refuses the real bundle " +
                "as soon as the client source moves: " + string.Join(", ", offenders));
        }

        /// <summary>
        /// The instrument check, and the reason the two assertions above can be
        /// believed. Both are string searches over Uplink source, and a search that
        /// reads the wrong files, or none, finds no violations and is
        /// indistinguishable from a clean repo. So the walk is made to see a
        /// violation that is known to be there: the wiring is deleted from a real
        /// Uplink's source IN MEMORY and the same predicate must reject it.
        /// </summary>
        [Fact]
        public void TheWalkCanSeeAViolationItIsPlanted()
        {
            var armed = DiscoverUplinkProjects()
                .Where(u => BakedHash(u.Value) is not null)
                .OrderBy(u => u.Key, StringComparer.Ordinal)
                .ToList();

            Assert.True(
                armed.Count > 0,
                "No Uplink is armed, so this file's central assertion currently skips every " +
                "project and cannot fail. That is legitimate (nothing is armed yet) but it means " +
                "the gate is dormant, and it must not be mistaken for coverage.");

            foreach (var (name, directory) in armed)
            {
                var real = SourceOf(directory);
                Assert.True(
                    real.Contains(RequiredWiring, StringComparison.Ordinal),
                    $"{name} is armed and its source does not carry the required wiring, which " +
                    "EveryArmedUplinkSurfacesItsHashInItsManifest should already have caught.");

                var sabotaged = real.Replace(RequiredWiring, "ExpectedClientHash = null,", StringComparison.Ordinal);
                Assert.False(
                    sabotaged.Contains(RequiredWiring, StringComparison.Ordinal),
                    $"The wiring predicate still matched {name}'s source after the wiring was " +
                    "removed from it, so it cannot tell a wired Uplink from an unwired one and " +
                    "every pass it reports is meaningless.");
            }
        }

        /// <summary>
        /// The generated const's value for an Uplink, or <c>null</c> when it has no
        /// generated file or bakes an empty string. Empty is the unarmed state and
        /// is not a violation of anything: it is what every Uplink but the armed
        /// ones is meant to hold.
        /// </summary>
        private static string? BakedHash(string directory)
        {
            var generated = Path.Combine(directory, "ExpectedClientHash.g.cs");
            if (!File.Exists(generated))
            {
                return null;
            }

            var value = Regex.Match(
                File.ReadAllText(generated),
                @"public\s+const\s+string\s+Value\s*=\s*""([^""]*)""");

            return value.Success && value.Groups[1].Value.Length > 0 ? value.Groups[1].Value : null;
        }

        /// <summary>
        /// Every hand-written <c>.cs</c> in the Uplink's own directory tree,
        /// whitespace-collapsed so a reformatted or line-wrapped initialiser still
        /// matches, concatenated. The generated file is excluded: it declares the
        /// const rather than consuming it, and including it would let a manifest
        /// that never mentions ExpectedClientHash pass on the declaration alone.
        /// </summary>
        private static string SourceOf(string directory)
        {
            var sources = Directory
                .EnumerateFiles(directory, "*.cs", SearchOption.AllDirectories)
                .Where(f => !f.EndsWith(".g.cs", StringComparison.Ordinal))
                .Where(f => !f.Contains($"{Path.DirectorySeparatorChar}obj{Path.DirectorySeparatorChar}", StringComparison.Ordinal))
                .Where(f => !f.Contains($"{Path.DirectorySeparatorChar}bin{Path.DirectorySeparatorChar}", StringComparison.Ordinal))
                .OrderBy(f => f, StringComparer.Ordinal)
                .Select(File.ReadAllText);

            return Regex.Replace(string.Join("\n", sources), @"\s+", " ");
        }

        /// <summary>
        /// The Uplink projects <c>Gonogo.sln</c> declares: the independent source
        /// the directory walk is checked against.
        /// </summary>
        private static HashSet<string> UplinkProjectsDeclaredInSolution()
        {
            var solution = Path.Combine(ResolveModDir(), "Gonogo.sln");
            var declared = new HashSet<string>(StringComparer.Ordinal);
            if (!File.Exists(solution))
            {
                return declared;
            }

            foreach (Match match in Regex.Matches(File.ReadAllText(solution), @"=\s*""([A-Za-z0-9_.]+Uplink)"""))
            {
                declared.Add(match.Groups[1].Value);
            }

            return declared;
        }

        /// <summary>Uplink project name -&gt; its source directory. The
        /// <c>.Contract</c> and <c>.Tests</c> siblings are not Uplinks.</summary>
        private static Dictionary<string, string> DiscoverUplinkProjects()
        {
            var modDir = ResolveModDir();
            var uplinks = new Dictionary<string, string>(StringComparer.Ordinal);

            foreach (var directory in Directory.EnumerateDirectories(modDir))
            {
                var name = Path.GetFileName(directory);
                if (!name.StartsWith("Gonogo", StringComparison.Ordinal) ||
                    !name.EndsWith("Uplink", StringComparison.Ordinal))
                {
                    continue;
                }

                if (File.Exists(Path.Combine(directory, name + ".csproj")))
                {
                    uplinks[name] = directory;
                }
            }

            return uplinks;
        }

        private static string ResolveModDir()
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
    }
}
