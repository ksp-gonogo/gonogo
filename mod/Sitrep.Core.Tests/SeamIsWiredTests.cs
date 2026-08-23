using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using Xunit;

namespace Sitrep.Core.Tests
{
    /// <summary>
    /// A seam a production type exposes for something to be PLUGGED INTO must have
    /// something in production that plugs into it.
    ///
    /// <para><b>The gap this sits in.</b>
    /// <see cref="SeamHasAProductionImplementerTests"/> asks whether a seam has an
    /// implementer, and stops there. That is one question short of the feature
    /// running: an implementer that exists and is never constructed, or a settable
    /// seam property nothing ever assigns, leaves the seam holding null on every
    /// live frame while the type graph looks complete. Both ratchets pass, every
    /// unit test of the code behind the seam passes, and the feature has never
    /// executed.</para>
    ///
    /// <para>It happened, and it is why this file exists.
    /// <c>ChannelEngine.SeededPropagation</c> shipped with a declaration, a reader
    /// in the command path, a full provider implementing it and a passing test
    /// suite. Nothing assigned it, so <c>vessel.trajectory.forVantage</c> refused
    /// on the rig for every argument, vantage and game state alike. The defect was
    /// invisible until a dispatcher fault one layer up was fixed, because until
    /// then the command never reached the reader at all.</para>
    ///
    /// <para><b>Why a different KIND of check, again.</b> A test that sets the
    /// property and asserts what happens after proves the code behind the seam and
    /// says nothing about whether anything in the shipped game ever sets it. The
    /// check that catches that must not itself be able to set it, so this one
    /// constructs nothing and asserts nothing about behaviour: it reads the shipped
    /// source and asks whether an assignment exists.</para>
    ///
    /// <para><b>Source text, not reflection</b>, for the same reason as its sibling:
    /// <c>Gonogo.sln</c> omits the projects needing the KSP managed assemblies, so
    /// the assignment site for anything wired in <c>Gonogo.KSP</c> is invisible to a
    /// scan of what this test process can load, and every such seam would report as
    /// unwired.</para>
    ///
    /// <para><b>Vendored code is not ours to wire.</b> Fleck carries four settable
    /// interface properties it assigns on its own internal paths, and holding a
    /// vendored library to this repo's wiring conventions would mean editing a
    /// dependency to satisfy a ratchet.</para>
    ///
    /// <para><b>Shrink-only.</b> An entry leaves <see cref="Debt"/> only by the seam
    /// gaining a production assignment. A new unwired seam fails, and so does a
    /// stale entry naming a seam that is now wired.</para>
    /// </summary>
    public class SeamIsWiredTests
    {
        /// <summary>
        /// Settable seam properties nothing in production assigns today. Each entry
        /// names the feature that cannot run because of it.
        /// </summary>
        private static readonly Dictionary<string, string> Debt = new(StringComparer.Ordinal)
        {
            // Empty, and it should stay that way. Its one entry was
            // ChannelEngine.SeededPropagation, which left this list when the
            // provider began being constructed and installed at bootstrap.
        };

        private static bool IsTestProject(string projectName) =>
            projectName.EndsWith(".Tests", StringComparison.Ordinal)
            || projectName.EndsWith(".TestSupport", StringComparison.Ordinal)
            || projectName.Contains("IntegrationTests", StringComparison.Ordinal)
            || projectName.Equals("GonogoDevTools", StringComparison.Ordinal);

        /// <summary>
        /// Third-party source kept in-tree. Its wiring is its own business.
        /// </summary>
        private static bool IsVendored(string file) =>
            file.Contains(Path.DirectorySeparatorChar + "Vendor" + Path.DirectorySeparatorChar, StringComparison.Ordinal);

        [Fact]
        public void EverySettableSeamPropertyIsAssignedInProduction()
        {
            var scan = Scan();

            var unwired = scan.Seams
                .Where(seam => !scan.Assigned.Contains(seam.Key))
                .Select(seam => seam.Key)
                .OrderBy(name => name, StringComparer.Ordinal)
                .ToList();

            var undeclaredDebt = unwired.Where(n => !Debt.ContainsKey(n)).ToList();

            Assert.True(
                undeclaredDebt.Count == 0,
                "These production types expose a seam for something to be plugged "
                + "into, and nothing in production ever plugs anything in, so "
                + "whatever reads them reads null on every live frame. A test that "
                + "assigns one by hand proves the code behind the seam, never that "
                + "the shipped game reaches it.\n  "
                + string.Join(
                    "\n  ",
                    undeclaredDebt.Select(n => n + "  declared at " + scan.Seams[n])));
        }

        [Fact]
        public void EveryDebtEntryIsStillUnwired()
        {
            var scan = Scan();

            var stale = Debt.Keys
                .Where(name => scan.Assigned.Contains(name))
                .OrderBy(name => name, StringComparer.Ordinal)
                .ToList();

            Assert.True(
                stale.Count == 0,
                "These seams are now assigned in production and must be removed from "
                + "Debt, so the list keeps describing the real state: "
                + string.Join(", ", stale));

            var vanished = Debt.Keys.Where(name => !scan.Seams.ContainsKey(name)).ToList();

            Assert.True(
                vanished.Count == 0,
                "These Debt entries name a seam that no longer exists in production "
                + "source; remove them: " + string.Join(", ", vanished));
        }

        /// <summary>
        /// The walk found what it is meant to be reading. A scan that silently
        /// stopped finding seams would report no violations, and no violations reads
        /// as success.
        /// </summary>
        [Fact]
        public void ScanFindsItsSubjects()
        {
            var scan = Scan();

            Assert.True(
                scan.Seams.ContainsKey("ChannelEngine.SeededPropagation"),
                "the scan did not find the seam this file was written for, so it is "
                + "not reading the source it thinks it is");

            Assert.True(
                scan.FilesScanned >= 350,
                "only " + scan.FilesScanned + " production .cs files read, against "
                + "this repo's several hundred: the walk is truncated");
        }

        /// <summary>
        /// The scan can SEE an unwired seam, proved against a source tree written
        /// for the purpose.
        ///
        /// <para>With <see cref="Debt"/> empty the real tree contains no unwired
        /// seam, so neither ratchet above can demonstrate the scan is capable of
        /// reporting one: a walk that had silently stopped matching declarations
        /// would pass both. Three claims, each failing differently: an assigned seam
        /// is not reported, an unassigned one is, and a seam assigned ONLY from a
        /// test project is reported anyway, which is the distinction the file
        /// exists to draw.</para>
        /// </summary>
        [Fact]
        public void TheScanSeesAPlantedUnwiredSeamAndIgnoresAPlantedTestAssignment()
        {
            var root = Path.Combine(
                Path.GetTempPath(), "seam-wiring-" + Guid.NewGuid().ToString("N"));
            try
            {
                Write(root, "Planted.Host", "Engine.cs", @"
namespace Planted
{
    public sealed class Engine
    {
        public IWired? Wired { get; set; }

        public IUnwired? Unwired { get; set; }

        public IDoubleOnly? DoubleOnly { get; set; }
    }
}
");
                Write(root, "Planted.Boot", "Boot.cs", @"
namespace Planted
{
    public static class Boot
    {
        public static void Go(Engine engine) { engine.Wired = null; }
    }
}
");
                Write(root, "Planted.Host.Tests", "EngineTests.cs", @"
namespace Planted.Tests
{
    public static class Fixture
    {
        public static void Arrange(Engine engine) { engine.DoubleOnly = null; }
    }
}
");

                var scan = Scan(root);

                Assert.Equal(3, scan.Seams.Count);
                Assert.Contains("Engine.Wired", scan.Assigned);
                Assert.DoesNotContain("Engine.Unwired", scan.Assigned);
                Assert.DoesNotContain("Engine.DoubleOnly", scan.Assigned);
            }
            finally
            {
                Directory.Delete(root, recursive: true);
            }
        }

        private static void Write(string root, string project, string file, string source)
        {
            var directory = Path.Combine(root, project);
            Directory.CreateDirectory(directory);
            File.WriteAllText(Path.Combine(directory, file), source);
        }

        private sealed class WiringScan
        {
            /// <summary>"Type.Property" -> where it is declared.</summary>
            public Dictionary<string, string> Seams { get; } = new(StringComparer.Ordinal);

            /// <summary>The seams production source assigns.</summary>
            public HashSet<string> Assigned { get; } = new(StringComparer.Ordinal);

            public int FilesScanned { get; set; }
        }

        private static readonly Regex SeamProperty = new(
            @"^\s*public\s+(I[A-Za-z0-9_]*)\??\s+([A-Za-z0-9_]+)\s*\{\s*get;\s*set;\s*\}",
            RegexOptions.Compiled);

        private static readonly Regex TypeName = new(
            @"^\s*(?:(?:public|internal|private|protected|sealed|abstract|static|partial)\s+)*"
            + @"\b(?:class|struct|record)\b\s+([A-Za-z0-9_]+)",
            RegexOptions.Compiled);

        private static WiringScan Scan() => Scan(ResolveModDir());

        private static WiringScan Scan(string modDir)
        {
            var scan = new WiringScan();
            var sources = new List<string>();

            foreach (var project in Directory.EnumerateDirectories(modDir))
            {
                var projectName = Path.GetFileName(project);
                if (IsTestProject(projectName))
                {
                    continue;
                }

                foreach (var file in Directory.EnumerateFiles(project, "*.cs", SearchOption.AllDirectories))
                {
                    if (file.Contains(Path.DirectorySeparatorChar + "obj" + Path.DirectorySeparatorChar, StringComparison.Ordinal)
                        || file.Contains(Path.DirectorySeparatorChar + "bin" + Path.DirectorySeparatorChar, StringComparison.Ordinal))
                    {
                        continue;
                    }

                    scan.FilesScanned++;
                    var text = File.ReadAllText(file);
                    sources.Add(text);

                    if (IsVendored(file))
                    {
                        continue;
                    }

                    var lines = text.Split('\n');
                    var enclosing = "";
                    for (var i = 0; i < lines.Length; i++)
                    {
                        var type = TypeName.Match(lines[i]);
                        if (type.Success)
                        {
                            enclosing = type.Groups[1].Value;
                        }

                        var seam = SeamProperty.Match(lines[i]);
                        if (!seam.Success || enclosing.Length == 0)
                        {
                            continue;
                        }

                        var key = enclosing + "." + seam.Groups[2].Value;
                        if (!scan.Seams.ContainsKey(key))
                        {
                            scan.Seams[key] = projectName + "/" + Path.GetFileName(file) + ":" + (i + 1);
                        }
                    }
                }
            }

            // An assignment anywhere in production counts, because the site that
            // wires a seam is routinely a different assembly from the one that
            // declares it: this repo's bootstrap lives in the assembly the solution
            // cannot build, which is the whole reason the scan reads text.
            foreach (var seam in scan.Seams.Keys)
            {
                var property = seam.Substring(seam.IndexOf('.') + 1);
                var assignment = new Regex(
                    @"(?<![A-Za-z0-9_])" + Regex.Escape(property) + @"\s*=(?!=)");
                foreach (var source in sources)
                {
                    foreach (Match match in assignment.Matches(source))
                    {
                        // The declaration itself is `IFoo? Bar { get; set; }`, which
                        // carries no `=`, so any match is a real assignment. A
                        // property-initialiser default would match, and it is also a
                        // real assignment, so counting it is correct.
                        if (match.Success)
                        {
                            scan.Assigned.Add(seam);
                            break;
                        }
                    }

                    if (scan.Assigned.Contains(seam))
                    {
                        break;
                    }
                }
            }

            return scan;
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
