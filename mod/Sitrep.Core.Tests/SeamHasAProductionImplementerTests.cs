using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using Xunit;

namespace Sitrep.Core.Tests
{
    /// <summary>
    /// A seam declared in production code must have something in production that
    /// satisfies it.
    ///
    /// <para><b>What this catches that no other test can.</b> A capability gated on
    /// <c>x is ISomething</c> is normally proved by a test that hands the gate an
    /// implementation of <c>ISomething</c> and asserts what happens after. That
    /// establishes the downstream behaviour and says nothing at all about whether
    /// any production caller can reach it, so an interface nothing implements
    /// produces a suite that is green over a feature that has never executed once.
    /// It happened: <c>IIntegratedTrajectorySource</c> shipped with a declaration, a
    /// single <c>is</c> check and zero implementers, while every test of the
    /// integrator behind it passed, because each of those tests opened the gate by
    /// hand.</para>
    ///
    /// <para><b>So this is deliberately a different KIND of check.</b> It asserts
    /// nothing about behaviour and never constructs anything. It reads the declared
    /// type graph of the shipped source and asks one mechanical question per seam:
    /// is there a production type that implements it. A mocked-open gate cannot
    /// express that failure, which is why the check that can must not itself be able
    /// to mock anything.</para>
    ///
    /// <para><b>Source text, not reflection.</b> <c>Gonogo.sln</c> deliberately omits
    /// the projects that need the KSP managed assemblies, so a reflection scan of
    /// what this test process can load cannot see <c>Gonogo.KSP</c> or any Uplink,
    /// and would then report their interfaces as unimplemented and their
    /// implementations as absent. Reading the checked-out <c>.cs</c> files covers
    /// every project regardless of what the solution builds.</para>
    ///
    /// <para><b>Transitive by design.</b> <c>ISitrepProvider</c> is implemented by
    /// nothing directly: ten seam interfaces extend it and their implementers
    /// satisfy it through those. Counting direct base-list mentions would have
    /// reported a base interface that works perfectly as dead, so the satisfied set
    /// is closed over interface inheritance before anything is judged.</para>
    ///
    /// <para><b>Shrink-only.</b> An entry leaves <see cref="Debt"/> only by the seam
    /// gaining a production implementer. A NEW unimplemented seam fails, and so does
    /// a STALE entry: a seam listed here that HAS an implementer fails too, because a
    /// debt list nobody prunes stops describing anything.</para>
    ///
    /// <para><b>The scan asserts it found its subjects.</b> A walk that silently
    /// returns nothing reports zero violations, and zero reads as success. So
    /// <see cref="ScanFindsItsSubjects"/> pins the discovery itself: named seams it
    /// must find, named implementers it must attribute, and floors on both counts.
    /// If the layout moves, that test fails first and says so.</para>
    /// </summary>
    public class SeamHasAProductionImplementerTests
    {
        /// <summary>
        /// Seams that have no production implementer today. Each entry names the
        /// feature that cannot execute because of it.
        /// </summary>
        private static readonly Dictionary<string, string> Debt = new(StringComparer.Ordinal)
        {
            // The n-body trajectory path. VesselUplink's ElementHorizon only says
            // Until when the elected propagation provider is one of these, so with
            // no implementer the horizon is always Unbounded, ElementArc always
            // refuses, and NBodyArcSource / NBodyTrajectory / KspPerturbers are
            // unreachable from the wire. Measured live 2026-08-22: trajectoryKind
            // Analytic, arc null, refusal Unspecified. Closing it needs an
            // implementation AND something that elects it.
            ["IIntegratedTrajectorySource"] =
                "the n-body trajectory arc: nothing can make VesselUplink's "
                + "propagation gate open, so the integrator never runs",
        };

        /// <summary>
        /// Projects whose types do not count as production: a test double satisfying
        /// a seam is exactly the situation this test exists to distinguish from a
        /// real implementation.
        /// </summary>
        private static bool IsTestProject(string projectName) =>
            projectName.EndsWith(".Tests", StringComparison.Ordinal)
            || projectName.EndsWith(".TestSupport", StringComparison.Ordinal)
            || projectName.Contains("IntegrationTests", StringComparison.Ordinal)
            || projectName.Equals("GonogoDevTools", StringComparison.Ordinal);

        [Fact]
        public void EverySeamDeclaredInProductionHasAProductionImplementer()
        {
            var graph = Scan();

            var unimplemented = graph.ProductionInterfaces.Keys
                .Where(name => !graph.Satisfied.Contains(name))
                .OrderBy(name => name, StringComparer.Ordinal)
                .ToList();

            var undeclaredDebt = unimplemented.Where(n => !Debt.ContainsKey(n)).ToList();

            Assert.True(
                undeclaredDebt.Count == 0,
                "These seams are declared in production and implemented by nothing in "
                + "production, so whatever they gate cannot run. A test that supplies "
                + "one by hand proves the code behind the gate, never that the gate "
                + "opens.\n  "
                + string.Join(
                    "\n  ",
                    undeclaredDebt.Select(n => n + "  declared at " + graph.ProductionInterfaces[n])));
        }

        [Fact]
        public void EveryDebtEntryIsStillUnimplemented()
        {
            var graph = Scan();

            var stale = Debt.Keys
                .Where(name => graph.Satisfied.Contains(name))
                .OrderBy(name => name, StringComparer.Ordinal)
                .ToList();

            Assert.True(
                stale.Count == 0,
                "These seams now HAVE a production implementer and must be removed from "
                + "Debt, so the list keeps describing the real state: "
                + string.Join(", ", stale));

            var vanished = Debt.Keys
                .Where(name => !graph.ProductionInterfaces.ContainsKey(name))
                .ToList();

            Assert.True(
                vanished.Count == 0,
                "These Debt entries name a seam that no longer exists in production "
                + "source; remove them: " + string.Join(", ", vanished));
        }

        [Fact]
        public void ScanFindsItsSubjects()
        {
            var graph = Scan();

            // A seam that IS satisfied, a seam that is NOT, and the marker base
            // interface only reachable through inheritance: if the walk breaks, at
            // least one of these stops being found and the count floors below fail
            // rather than the ratchet passing over an empty set.
            foreach (var required in new[]
                     {
                         "ISitrepUplink", "IPropagationProvider", "ICommsBackend",
                         "IIntegratedTrajectorySource", "ISitrepProvider",
                     })
            {
                Assert.True(
                    graph.ProductionInterfaces.ContainsKey(required),
                    "the scan did not find " + required + ", so it is not reading the "
                    + "source it thinks it is");
            }

            foreach (var required in new[] { "IPropagationProvider", "ISitrepProvider", "ISitrepUplink" })
            {
                Assert.True(
                    graph.Satisfied.Contains(required),
                    required + " has a production implementer in this repo; the scan "
                    + "failing to attribute one means it is not reading base lists");
            }

            Assert.False(
                graph.Satisfied.Contains("IIntegratedTrajectorySource"),
                "IIntegratedTrajectorySource has no implementer anywhere; the scan "
                + "claiming otherwise means it is counting something that is not one");

            Assert.True(
                graph.ProductionInterfaces.Count >= 40,
                "only " + graph.ProductionInterfaces.Count + " production seams found, "
                + "which is far below this repo's real count: the walk is truncated");

            Assert.True(
                graph.FilesScanned >= 350,
                "only " + graph.FilesScanned + " production .cs files read, against "
                + "this repo's several hundred: the walk is truncated");

            Assert.True(
                graph.ProductionTypeCount >= 100,
                "only " + graph.ProductionTypeCount + " production types with a base "
                + "list found: the walk is reading files but not their declarations");
        }

        private sealed class TypeGraph
        {
            /// <summary>Seam name -> where it is declared, production only.</summary>
            public Dictionary<string, string> ProductionInterfaces { get; } =
                new(StringComparer.Ordinal);

            /// <summary>Seams a production type implements, closed over interface inheritance.</summary>
            public HashSet<string> Satisfied { get; } = new(StringComparer.Ordinal);

            public int ProductionTypeCount { get; set; }

            public int FilesScanned { get; set; }
        }

        private static readonly Regex InterfaceDeclaration = new(
            @"^\s*(?:public|internal|protected|private)?\s*(?:partial\s+)?interface\s+(I[A-Za-z0-9_]*)",
            RegexOptions.Compiled);

        private static readonly Regex TypeDeclaration = new(
            @"^\s*(?:(?:public|internal|private|protected|sealed|abstract|static|partial|readonly|new)\s+)*"
            + @"\b(?:class|struct|record)\b(?:\s+(?:class|struct))?\s+([A-Za-z0-9_]+)\s*(?:<[^>]*>)?\s*"
            + @"(?:\([^)]*\))?\s*:\s*(.+)$",
            RegexOptions.Compiled);

        private static readonly Regex InterfaceExtends = new(
            @"^\s*(?:public|internal|protected|private)?\s*(?:partial\s+)?interface\s+(I[A-Za-z0-9_]*)\s*"
            + @"(?:<[^>]*>)?\s*:\s*(.+)$",
            RegexOptions.Compiled);

        private static readonly Regex Identifier = new(@"[A-Za-z_][A-Za-z0-9_]*", RegexOptions.Compiled);

        private static TypeGraph Scan()
        {
            var modDir = ResolveModDir();
            var graph = new TypeGraph();

            // Concrete production type -> the names in its base list.
            var implementsDirect = new List<string[]>();
            // Interface -> the interfaces it extends, so the satisfied set can close
            // over inheritance rather than counting direct mentions only.
            var extends = new Dictionary<string, string[]>(StringComparer.Ordinal);

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

                    graph.FilesScanned++;
                    var lines = File.ReadAllLines(file);
                    for (var i = 0; i < lines.Length; i++)
                    {
                        var line = lines[i];

                        var declaration = InterfaceDeclaration.Match(line);
                        if (declaration.Success)
                        {
                            var name = declaration.Groups[1].Value;
                            if (!graph.ProductionInterfaces.ContainsKey(name))
                            {
                                graph.ProductionInterfaces[name] =
                                    projectName + "/" + Path.GetFileName(file) + ":" + (i + 1);
                            }

                            var inherits = InterfaceExtends.Match(line);
                            if (inherits.Success)
                            {
                                extends[name] = NamesIn(inherits.Groups[2].Value);
                            }

                            continue;
                        }

                        var type = TypeDeclaration.Match(line);
                        if (!type.Success)
                        {
                            continue;
                        }

                        graph.ProductionTypeCount++;
                        implementsDirect.Add(NamesIn(BaseList(lines, i, type.Groups[2].Value)));
                    }
                }
            }

            foreach (var bases in implementsDirect)
            {
                foreach (var name in bases)
                {
                    Close(name, graph.Satisfied, extends);
                }
            }

            return graph;
        }

        /// <summary>
        /// A base list broken across lines still names its interfaces, so it is
        /// joined back up before the names are read out of it.
        /// </summary>
        private static string BaseList(string[] lines, int index, string first)
        {
            var joined = first;
            var next = index + 1;
            while (joined.TrimEnd().EndsWith(",", StringComparison.Ordinal) && next < lines.Length)
            {
                joined += " " + lines[next];
                next++;
            }

            return joined;
        }

        private static string[] NamesIn(string text) =>
            Identifier.Matches(text).Select(m => m.Value).Distinct(StringComparer.Ordinal).ToArray();

        private static void Close(
            string name,
            HashSet<string> satisfied,
            Dictionary<string, string[]> extends)
        {
            if (!satisfied.Add(name))
            {
                return;
            }

            if (extends.TryGetValue(name, out var parents))
            {
                foreach (var parent in parents)
                {
                    Close(parent, satisfied, extends);
                }
            }
        }

        /// <summary>
        /// Walks up from the test assembly to the checked-out <c>mod/</c> directory,
        /// same pattern as <see cref="UplinkIsolationTests"/>.
        /// </summary>
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
