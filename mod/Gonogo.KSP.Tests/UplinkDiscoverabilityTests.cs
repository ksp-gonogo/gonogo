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

        [Fact]
        public void TheScanFindsEveryUplinkProject()
        {
            // A directory walk that matches nothing reports no violations, and no
            // violations reads as success. This is the check that the two above are
            // looking at the shipped roster, named across four different projects and
            // including the two whose filenames do not end in Uplink.cs.
            var found = UplinkSourceFiles()
                .SelectMany(file => UplinkClass.Matches(File.ReadAllText(file))
                    .Select(m => m.Groups[1].Value))
                .ToHashSet(StringComparer.Ordinal);

            foreach (var required in new[]
                     {
                         "VesselUplink", "FleetChannels", "KosExtension",
                         "PrincipiaUplink", "KerbalismUplink", "ScansatUplink",
                     })
            {
                Assert.Contains(required, found);
            }

            Assert.True(
                found.Count >= 25,
                "only " + found.Count + " uplinks found across mod/, against this repo's "
                + "twenty-seven: the walk is truncated and the checks above are passing "
                + "over whatever it stopped reading");
        }

        /// <summary>
        /// Every production <c>.cs</c> under <c>mod/</c>, not
        /// <c>Gonogo.KSP/**/*Uplink.cs</c>.
        ///
        /// <para>Both halves of that widening were load-bearing. Eleven of this
        /// repo's twenty-seven uplinks ship from their own <c>Gonogo*Uplink</c>
        /// project and were never in scope at all, and an uplink class does not have
        /// to live in a file whose name ends <c>Uplink.cs</c>:
        /// <c>FleetChannels</c> and <c>KosExtension</c> do not, and
        /// <c>FleetChannels</c> is hand-registered while being invisible to the very
        /// check that exists because a fleet uplink once shipped unregistered.</para>
        ///
        /// <para>Test projects are excluded because a test double carrying the
        /// attribute proves nothing about the shipped roster.</para>
        /// </summary>
        private static IEnumerable<string> UplinkSourceFiles() =>
            Directory.EnumerateDirectories(ModDirectory())
                .Where(project => !IsTestProject(Path.GetFileName(project)))
                .SelectMany(project => Directory.EnumerateFiles(project, "*.cs", SearchOption.AllDirectories))
                .Where(file =>
                    !file.Contains(Path.DirectorySeparatorChar + "obj" + Path.DirectorySeparatorChar, StringComparison.Ordinal)
                    && !file.Contains(Path.DirectorySeparatorChar + "bin" + Path.DirectorySeparatorChar, StringComparison.Ordinal));

        private static bool IsTestProject(string projectName) =>
            projectName.EndsWith(".Tests", StringComparison.Ordinal)
            || projectName.EndsWith(".TestSupport", StringComparison.Ordinal)
            || projectName.Contains("IntegrationTests", StringComparison.Ordinal)
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
