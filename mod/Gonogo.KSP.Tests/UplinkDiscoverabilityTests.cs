using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using Xunit;

namespace Gonogo.KSP.Tests
{
    /// <summary>
    /// An <see cref="Sitrep.Contract.ISitrepUplink"/> reaches the running mod
    /// one of two ways: <c>UplinkDiscovery</c> finds it by its
    /// <c>[SitrepUplink]</c> attribute, or <c>GonogoAddon</c> constructs it by
    /// hand because it takes a constructor argument discovery cannot supply. An
    /// uplink that is neither compiles, ships, passes every test it has, and
    /// simply never runs.
    ///
    /// <para>That is what happened to <c>FleetDelayUplink</c>: no attribute,
    /// not hand-registered, so the whole <c>fleet.</c> namespace, per-vessel
    /// delay, orbit and contact, was absent from the live uplink roster with
    /// nothing anywhere saying so. It surfaced only by subscribing to a channel
    /// on the real wire and getting back not even a subscribe
    /// acknowledgement.</para>
    ///
    /// <para>Reads SOURCE rather than reflecting over the assembly: this test
    /// project deliberately cherry-picks KSP-free files rather than referencing
    /// <c>Gonogo.KSP</c> (which would drag in the KSP DLLs), so the uplink types
    /// are not loadable here. A text scan is the weaker tool but it is the one
    /// that can see every uplink.</para>
    /// </summary>
    public class UplinkDiscoverabilityTests
    {
        /// <summary>
        /// Uplinks <c>GonogoAddon</c> constructs itself. Adding a file here is a
        /// claim that <c>GonogoAddon</c> really does call <c>RegisterUplink</c>
        /// for it, which <see cref="HandRegisteredUplinksAreActuallyRegistered"/>
        /// then checks.
        /// </summary>
        private static readonly string[] HandRegistered =
        {
            "CommandCentreDelayUplink",
            // Deliberately attribute-free: it earns its Availability from the
            // elected comms backend rather than from its own detection, so
            // GonogoAddon constructs it. It went unlisted here for as long as this
            // scan only read Gonogo.KSP/**/*Uplink.cs, which its filename does not
            // match, so the check born from an unregistered fleet uplink could not
            // see the fleet uplink.
            "FleetChannels",
        };

        private static readonly Regex UplinkClass = new Regex(
            @"class\s+(\w+)\s*:\s*[^{]*\bISitrepUplink\b", RegexOptions.Compiled);

        [Fact]
        public void EveryUplinkIsEitherDiscoverableOrHandRegistered()
        {
            var undiscoverable = new List<string>();

            foreach (var file in UplinkSourceFiles())
            {
                var source = File.ReadAllText(file);
                foreach (Match match in UplinkClass.Matches(source))
                {
                    var name = match.Groups[1].Value;
                    if (HandRegistered.Contains(name)) continue;
                    if (source.Contains("[SitrepUplink(")) continue;
                    undiscoverable.Add(name + "  (" + Path.GetFileName(file) + ")");
                }
            }

            Assert.True(
                undiscoverable.Count == 0,
                "These uplinks will never run: no [SitrepUplink] attribute and not hand-registered in "
                + "GonogoAddon. Add the attribute, or add the type to HandRegistered once GonogoAddon really "
                + "constructs it:\n  " + string.Join("\n  ", undiscoverable));
        }

        [Fact]
        public void HandRegisteredUplinksAreActuallyRegistered()
        {
            var addon = File.ReadAllText(Path.Combine(GonogoKspDirectory(), "GonogoAddon.cs"));

            foreach (var name in HandRegistered)
            {
                Assert.True(
                    addon.Contains("RegisterUplink(new " + name + "(")
                        || addon.Contains("." + name + "("),
                    name + " is listed as hand-registered but GonogoAddon never constructs it.");
            }
        }

        [Fact]
        public void EveryDiscoverableUplinkCanBeConstructedByDiscovery()
        {
            // UplinkDiscovery instantiates through GetConstructor(Type.EmptyTypes)
            // and, finding none, writes to Console.Error and moves on. In KSP that
            // stream goes nowhere an operator or a log reader will see, so the whole
            // uplink is absent with the same silence an unregistered one has.
            var unconstructable = new List<string>();

            foreach (var file in UplinkSourceFiles())
            {
                var source = File.ReadAllText(file);
                if (!source.Contains("[SitrepUplink(", StringComparison.Ordinal))
                {
                    continue;
                }

                foreach (Match match in UplinkClass.Matches(source))
                {
                    var name = match.Groups[1].Value;
                    var declaresACtor = new Regex(
                        @"\b(?:public|internal|private|protected)\s+" + Regex.Escape(name) + @"\s*\(")
                        .IsMatch(source);
                    var declaresAParameterlessCtor = new Regex(
                        @"\bpublic\s+" + Regex.Escape(name) + @"\s*\(\s*\)")
                        .IsMatch(source);

                    // No explicit constructor at all means the compiler supplies the
                    // public parameterless one, which is exactly what discovery wants.
                    if (declaresACtor && !declaresAParameterlessCtor)
                    {
                        unconstructable.Add(name + "  (" + Path.GetFileName(file) + ")");
                    }
                }
            }

            Assert.True(
                unconstructable.Count == 0,
                "These uplinks carry [SitrepUplink] but declare no public parameterless "
                + "constructor, so UplinkDiscovery skips them to Console.Error and they "
                + "never run:\n  " + string.Join("\n  ", unconstructable));
        }

        /// <summary>
        /// A directory walk that matches nothing reports no violations, and no
        /// violations reads as success. This is the check that the tests above are
        /// looking at the shipped roster.
        ///
        /// <para>It used to require five uplinks by name, three of them from mod
        /// Uplinks bound for the gonogo-uplinks repo, and a floor of twenty-three,
        /// which the first of those moves would have broken. There is no count now
        /// and no name kept for this check alone, so it means the same thing however
        /// many Uplink projects this repo still has. Each part answers a different
        /// way the walk can go blind.</para>
        /// <list type="bullet">
        /// <item>Skipping a project: every production project <c>Gonogo.sln</c>
        /// declares must be walked, and the solution must declare
        /// <c>Gonogo.KSP</c>, so it cannot be an empty or foreign stand-in</item>
        /// <item>Skipping files: every <see cref="HandRegistered"/> uplink must be
        /// found, which reaches a file whose name does not end in <c>Uplink.cs</c>
        /// and a file in a subdirectory</item>
        /// <item>A class pattern that stopped matching: every walked file carrying a
        /// <c>[SitrepUplink(</c> attribute line must yield an uplink class</item>
        /// </list>
        /// </summary>
        [Fact]
        public void TheScanFindsEveryUplinkProject()
        {
            var walked = WalkedProjects().Select(Path.GetFileName).ToHashSet(StringComparer.Ordinal);
            var declared = ProductionProjectsDeclaredInSolution();

            Assert.True(
                declared.Contains("Gonogo.KSP"),
                "Gonogo.sln does not declare Gonogo.KSP, so it is not the solution this repo builds and "
                + "checking the walk against it proves nothing. Declared: " + string.Join(", ", declared));

            var unwalked = declared.Except(walked).OrderBy(n => n, StringComparer.Ordinal).ToList();
            Assert.True(
                unwalked.Count == 0,
                "Gonogo.sln declares production projects the uplink walk never read, so an uplink in "
                + "one of them is invisible to every check above: " + string.Join(", ", unwalked));

            var files = UplinkSourceFiles().ToList();
            var found = files
                .SelectMany(file => UplinkClass.Matches(File.ReadAllText(file))
                    .Select(m => m.Groups[1].Value))
                .ToHashSet(StringComparer.Ordinal);

            foreach (var required in HandRegistered)
            {
                Assert.True(
                    found.Contains(required),
                    required + " is hand-registered in GonogoAddon and the walk did not find its class, "
                    + "so the walk is truncated and the checks above are passing over whatever it "
                    + "stopped reading. Found: " + string.Join(", ", found.OrderBy(n => n, StringComparer.Ordinal)));
            }

            var attributeLine = new Regex(@"^\s*\[SitrepUplink\(", RegexOptions.Multiline);
            var attributedWithNoClass = files
                .Where(file =>
                {
                    var source = File.ReadAllText(file);
                    return attributeLine.IsMatch(source) && !UplinkClass.IsMatch(source);
                })
                .Select(file => Path.GetRelativePath(ModDirectory(), file))
                .OrderBy(p => p, StringComparer.Ordinal)
                .ToList();

            Assert.True(
                attributedWithNoClass.Count == 0,
                "These files carry a [SitrepUplink] attribute and the uplink class pattern matched "
                + "nothing in them, so every check above is blind to the uplink they declare:\n  "
                + string.Join("\n  ", attributedWithNoClass));
        }

        /// <summary>
        /// Every production <c>.cs</c> under <c>mod/</c>, not
        /// <c>Gonogo.KSP/**/*Uplink.cs</c>.
        ///
        /// <para>Both halves of that widening were load-bearing. Uplinks that ship
        /// from their own <c>Gonogo*Uplink</c> project were never in scope at all,
        /// and an uplink class does not have to live in a file whose name ends
        /// <c>Uplink.cs</c>: <c>FleetChannels</c> does not, and is hand-registered
        /// while being invisible to the very check that exists because a fleet
        /// uplink once shipped unregistered.</para>
        ///
        /// <para>Test projects are excluded because a test double carrying the
        /// attribute proves nothing about the shipped roster.</para>
        /// </summary>
        private static IEnumerable<string> UplinkSourceFiles() =>
            WalkedProjects()
                .SelectMany(project => Directory.EnumerateFiles(project, "*.cs", SearchOption.AllDirectories))
                .Where(file =>
                    !file.Contains(Path.DirectorySeparatorChar + "obj" + Path.DirectorySeparatorChar, StringComparison.Ordinal)
                    && !file.Contains(Path.DirectorySeparatorChar + "bin" + Path.DirectorySeparatorChar, StringComparison.Ordinal));

        private static IEnumerable<string> WalkedProjects() =>
            Directory.EnumerateDirectories(ModDirectory())
                .Where(project => !IsTestProject(Path.GetFileName(project)));

        /// <summary>
        /// The production projects <c>Gonogo.sln</c> declares, by the directory their
        /// csproj sits in: a source independent of the directory walk.
        ///
        /// <para>A test project here is one whose csproj references
        /// <c>Microsoft.NET.Test.Sdk</c>, not one <see cref="IsTestProject"/> names,
        /// so a name rule widened to swallow a production project is caught rather
        /// than applied to both sides. Only the projects that are not test runners
        /// but ship nothing (<see cref="IsUnshipped"/>) are shared. Solution folders
        /// carry no csproj and are skipped.</para>
        /// </summary>
        private static HashSet<string> ProductionProjectsDeclaredInSolution()
        {
            var project = new Regex(@"^Project\(""\{[^}]+\}""\)\s*=\s*""[^""]+"",\s*""(([^""\\/]+)[\\/][^""]+\.csproj)""", RegexOptions.Multiline);
            return project.Matches(File.ReadAllText(Path.Combine(ModDirectory(), "Gonogo.sln")))
                .Where(m => !File.ReadAllText(Path.Combine(ModDirectory(), m.Groups[1].Value.Replace('\\', Path.DirectorySeparatorChar)))
                    .Contains("Microsoft.NET.Test.Sdk", StringComparison.Ordinal))
                .Select(m => m.Groups[2].Value)
                .Where(name => !IsUnshipped(name))
                .ToHashSet(StringComparer.Ordinal);
        }

        private static bool IsTestProject(string projectName) =>
            projectName.EndsWith(".Tests", StringComparison.Ordinal)
            || projectName.Contains("IntegrationTests", StringComparison.Ordinal)
            || IsUnshipped(projectName);

        private static bool IsUnshipped(string projectName) =>
            projectName.EndsWith(".TestSupport", StringComparison.Ordinal)
            || projectName.Equals("GonogoDevTools", StringComparison.Ordinal);

        private static string ModDirectory() =>
            Directory.GetParent(GonogoKspDirectory())!.FullName;

        private static string GonogoKspDirectory()
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
            throw new DirectoryNotFoundException("Could not locate mod/Gonogo.KSP from " + AppContext.BaseDirectory);
        }
    }
}
