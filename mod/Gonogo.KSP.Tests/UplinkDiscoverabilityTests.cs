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

        private static IEnumerable<string> UplinkSourceFiles() =>
            Directory.EnumerateFiles(GonogoKspDirectory(), "*Uplink.cs", SearchOption.AllDirectories);

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
