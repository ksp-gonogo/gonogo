using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using Xunit;

namespace GonogoRp1Uplink.Tests
{
    /// <summary>
    /// Holds <see cref="Rp1ReflectionTargets"/> to the production walk, and needs
    /// no RP-1 install to do it, so this half runs on every checkout and in CI.
    /// </summary>
    /// <remarks>
    /// <para>These tests make no claim about RP-1 compatibility and cannot: they
    /// never open an RP-1 assembly. What they close is the other hole, the one the
    /// compatibility check cannot see from where it stands. A manifest that has
    /// fallen behind the walk verifies a shrinking subset of it and goes on
    /// passing, and the members it stopped covering are exactly the newest ones,
    /// which are the least proven. That is the same failure the guard exists to
    /// fix, one level up.</para>
    ///
    /// <para>The sweep is deliberately blunt: every single-word string literal in
    /// a reflection STATEMENT has to be accounted for, either as a manifest target,
    /// as a member RP-1 does not own, or as a literal that is not a member name at
    /// all. Blunt because a check tuned to the call shapes that exist today would
    /// quietly stop seeing a call written a new way, and an unaccounted literal is
    /// cheap to add while a missed one is invisible.</para>
    /// </remarks>
    public class Rp1ReflectionManifestTests
    {
        /// <summary>Every production file that reaches RP-1 by string.</summary>
        private static readonly string[] ReflectionSources =
        {
            "Rp1Types.cs",
            "Rp1ScReflection.cs",
            "Rp1CrewReflection.cs",
            "Rp1CrewStandingBackend.cs",
            "Rp1ProgramsReflection.cs",
            "Rp1EconomyBackend.cs",
            "Rp1EconomyUpkeepQuery.cs",
            "Rp1LaunchGate.cs",
            "Rp1CareerProjectGate.cs",
            "Rp1BuildCommands.cs",
            "Rp1BuildStartCommands.cs",
            "Rp1Pricing.cs",
            "Rp1VehicleCommands.cs",
            "Rp1ComplexWrites.cs",
            "Rp1PersonnelCommands.cs",
            "Rp1DerivedCurrencyWithholder.cs",
            "Rp1SimulationBackend.cs",
        };

        /// <summary>
        /// Every production file in the Uplink that could reach RP-1 by string,
        /// so a file ADDED to the Uplink and not to
        /// <see cref="ReflectionSources"/> fails here rather than going unwatched.
        ///
        /// <para>Written because that is exactly what happened: the list above was
        /// correct when it was made and then <c>Rp1VehicleCommands.cs</c> was
        /// added with four handlers' worth of reflection in it. The sweep went on
        /// reporting success, because a check cannot see a file it was never told
        /// to open. The list of files to scan is itself a thing that can drift,
        /// and only a DIFFERENT kind of check catches that.</para>
        /// </summary>
        private const string ReflectionMarker = "Rp1Types.";

        /// <summary>
        /// The calls that reach RP-1 by name. <c>Find</c> is here too: it takes a
        /// type name rather than a member name, and a literal type name reaching
        /// this sweep is a type the manifest has to know about.
        /// </summary>
        private static readonly Regex ReflectionCall = new(
            @"\b(Member|StaticValue|WriteDouble|ReadDouble|ReadInt|ReadBool|ReadString|ReadGuidString|ReadEnumName|InstanceMethod|StaticMethod|GetMethod|Find)\s*\(",
            RegexOptions.Compiled);

        private static readonly Regex SingleWordLiteral = new(
            @"""([A-Za-z_][A-Za-z0-9_]*)""", RegexOptions.Compiled);

        private static readonly Regex Rp1TypeLiteral = new(
            @"""((?:RP0|ROUtils)\.[A-Za-z0-9_.+]+)""", RegexOptions.Compiled);

        [Fact]
        public void Every_name_a_reflection_call_reaches_RP1_by_is_accounted_for_in_the_manifest()
        {
            var unaccounted = new List<string>();

            foreach (var file in ReflectionSources)
            {
                foreach (var statement in Statements(ReadUplinkSource(file)))
                {
                    if (!ReflectionCall.IsMatch(statement))
                    {
                        continue;
                    }
                    foreach (Match literal in SingleWordLiteral.Matches(statement))
                    {
                        var name = literal.Groups[1].Value;
                        if (Rp1ReflectionTargets.MemberNames.Contains(name)
                            || Rp1ReflectionTargets.OutOfScope.ContainsKey(name)
                            || Rp1ReflectionTargets.NotMemberNames.ContainsKey(name))
                        {
                            continue;
                        }
                        unaccounted.Add(file + ": \"" + name + "\" in " + Trim(statement));
                    }
                }
            }

            Assert.True(
                unaccounted.Count == 0,
                "The RP-1 walk reaches names the compatibility manifest does not cover, so those names are guarded"
                + " by nothing. Add each to Rp1ReflectionTargets.Members/Methods/EnumMembers, or to OutOfScope"
                + " (RP-1 does not own it) or NotMemberNames (it is not a member name) with the reason:"
                + Environment.NewLine + "  - " + string.Join(Environment.NewLine + "  - ", unaccounted));
        }

        [Fact]
        public void Every_RP1_type_name_in_the_production_walk_is_a_manifest_type()
        {
            var known = Rp1ReflectionTargets.Types.Select(t => t.Type).ToHashSet(StringComparer.Ordinal);
            var unaccounted = new List<string>();

            foreach (var file in ReflectionSources)
            {
                var source = ReadUplinkSource(file);
                foreach (Match literal in Rp1TypeLiteral.Matches(source))
                {
                    var name = literal.Groups[1].Value;
                    if (!known.Contains(name))
                    {
                        unaccounted.Add(file + ": \"" + name + "\"");
                    }
                }
            }

            Assert.True(
                unaccounted.Count == 0,
                "The walk resolves RP-1 types the manifest does not list, so their absence in a future release would"
                + " be caught by nothing:" + Environment.NewLine
                + "  - " + string.Join(Environment.NewLine + "  - ", unaccounted));
        }

        [Fact]
        public void Every_manifest_member_is_still_a_name_the_production_walk_uses()
        {
            var sources = ReflectionSources.Select(ReadUplinkSource).ToArray();
            var stale = new List<string>();

            foreach (var name in Rp1ReflectionTargets.MemberNames)
            {
                var quoted = "\"" + name + "\"";
                if (!sources.Any(s => s.Contains(quoted, StringComparison.Ordinal)))
                {
                    stale.Add(name);
                }
            }

            Assert.True(
                stale.Count == 0,
                "The manifest claims members the walk no longer reads. A manifest that outlives its walk makes a"
                + " compatibility run look thorough while it checks things nothing depends on:" + Environment.NewLine
                + "  - " + string.Join(Environment.NewLine + "  - ", stale));
        }

        [Fact]
        public void Every_manifest_type_is_named_somewhere_in_the_production_walk()
        {
            var sources = ReflectionSources.Select(ReadUplinkSource).ToArray();
            var stale = new List<string>();

            foreach (var target in Rp1ReflectionTargets.Types)
            {
                // The nested subsidy struct is composed at the call site
                // (MaintenanceTypeName + "+SubsidyDetails"), so the simple name is
                // what appears in the source rather than the full one.
                var simple = target.Type.Split('.', '+').Last();
                if (!sources.Any(s => s.Contains(simple, StringComparison.Ordinal)))
                {
                    stale.Add(target.Type);
                }
            }

            Assert.True(
                stale.Count == 0,
                "The manifest lists RP-1 types the walk no longer resolves:" + Environment.NewLine
                + "  - " + string.Join(Environment.NewLine + "  - ", stale));
        }

        [Fact]
        public void No_manifest_target_is_declared_twice_with_a_different_expectation()
        {
            var conflicts = Rp1ReflectionTargets.Members
                .GroupBy(m => m.Assembly + "|" + m.Type + "|" + m.Member, StringComparer.Ordinal)
                .Where(g => g.Select(m => m.Reader + "/" + m.Static).Distinct().Count() > 1)
                .Select(g => g.Key + " expected as " + string.Join(" and ", g.Select(m => m.Reader + "/static=" + m.Static)))
                .ToList();

            Assert.True(
                conflicts.Count == 0,
                "One member is claimed with two different shapes, so one of the two claims is wrong and the guard"
                + " would report a failure for a member that is fine:" + Environment.NewLine
                + "  - " + string.Join(Environment.NewLine + "  - ", conflicts));
        }

        [Fact]
        public void The_installed_RP1_guard_was_compiled_when_this_run_declared_that_it_had_to_be()
        {
            // The one place a run can insist. The csproj gate leaves
            // Rp1InstalledCompatibilityTests out of the compilation when it cannot
            // find RP0.dll, which is right for CI and for a worktree and wrong for
            // a release check, so a release check says so and this fails if the
            // guard was not there.
#if RP1_COMPAT_GUARD
            const bool guardCompiled = true;
#else
            const bool guardCompiled = false;
#endif
            var required = Environment.GetEnvironmentVariable("GONOGO_RP1_COMPAT_REQUIRED") is "1" or "true";

            Assert.True(
                guardCompiled || !required,
                "RP-1 COMPATIBILITY NOT VERIFIED: GONOGO_RP1_COMPAT_REQUIRED is set, so this run was supposed to"
                + " check the installed RP-1 against the reflection manifest, and the guard was not compiled"
                + " because the build could not find RP0.dll. Pass /p:Rp1Plugins=<dir containing RP0.dll>, or set"
                + " GONOGO_RP1_PLUGINS or KSP_GAMEDATA.");
        }

        /// <summary>
        /// The source split into statements, comment text removed. Statements
        /// rather than lines because a reflection call wrapped over two lines puts
        /// the call on one and the name on the next, and a line-wise sweep sees
        /// neither half as a reflection call carrying a name.
        /// </summary>
        private static IEnumerable<string> Statements(string source)
        {
            var stripped = string.Join(
                "\n",
                source.Split('\n').Select(line =>
                {
                    var trimmed = line.TrimStart();
                    return trimmed.StartsWith("//", StringComparison.Ordinal) ? "" : line;
                }));

            return stripped.Split(';');
        }

        private static string Trim(string statement)
        {
            var flat = Regex.Replace(statement, @"\s+", " ").Trim();
            return flat.Length <= 120 ? flat : flat.Substring(0, 117) + "...";
        }

        [Fact]
        public void No_production_file_reaches_RP1_by_string_without_being_swept()
        {
            var unwatched = new List<string>();
            foreach (var path in Directory.GetFiles(UplinkDirectory(), "*.cs"))
            {
                var name = Path.GetFileName(path);
                if (ReflectionSources.Contains(name))
                {
                    continue;
                }
                if (File.ReadAllText(path).Contains(ReflectionMarker))
                {
                    unwatched.Add(name);
                }
            }

            Assert.True(
                unwatched.Count == 0,
                "These files reach RP-1 through Rp1Types and are not in ReflectionSources, so every name they "
                + "use is guarded by nothing and the manifest sweep reports success without looking at them: "
                + string.Join(", ", unwatched));
        }

        private static string UplinkDirectory()
        {
            for (var dir = new DirectoryInfo(AppContext.BaseDirectory); dir != null; dir = dir.Parent)
            {
                var candidate = Path.Combine(dir.FullName, "mod", "GonogoRp1Uplink");
                if (Directory.Exists(candidate))
                {
                    return candidate;
                }
            }
            throw new DirectoryNotFoundException(
                "Could not find mod/GonogoRp1Uplink from " + AppContext.BaseDirectory);
        }

        private static string ReadUplinkSource(string fileName)
        {
            for (var dir = new DirectoryInfo(AppContext.BaseDirectory); dir != null; dir = dir.Parent)
            {
                var candidate = Path.Combine(dir.FullName, "mod", "GonogoRp1Uplink", fileName);
                if (File.Exists(candidate))
                {
                    return File.ReadAllText(candidate);
                }
            }

            throw new FileNotFoundException(
                "Could not find mod/GonogoRp1Uplink/" + fileName + " from " + AppContext.BaseDirectory);
        }
    }
}
