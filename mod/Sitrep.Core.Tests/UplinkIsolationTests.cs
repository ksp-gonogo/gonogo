using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using Xunit;

namespace Sitrep.Core.Tests
{
    /// <summary>
    /// The mod-side half of the Uplink isolation rule
    /// (<c>packages/core/src/uplink-isolation.test.ts</c> is the client half):
    /// an Uplink may build against <c>Sitrep.Contract</c> and its own
    /// <c>&lt;Uplink&gt;.Contract</c> slice, and nothing else of this repo's.
    /// <c>Sitrep.Host</c>, <c>Sitrep.Core</c>, <c>Sitrep.Transport</c>,
    /// <c>Sitrep.Propagation</c> and <c>Gonogo.KSP</c> are unpublished: an outside
    /// author can neither install nor build against them, so an Uplink that reaches
    /// into one has stopped being an example of what an outside author can write.
    /// There is no first-party exemption; shipping bundled with the mod changes how
    /// an Uplink is distributed, not what it may reference.
    ///
    /// <para><b>The <c>&lt;Uplink&gt;.Tests</c> siblings are in scope too.</b> A
    /// gate told to skip a directory reports it clean, which is how a debt
    /// list here can read zero while a Tests project breaches the rule out of
    /// the walk's sight. A Tests project is part of the Uplink it tests,
    /// it names that Uplink's types and compiles that Uplink's sources, so it moves
    /// with the Uplink when the Uplink leaves. An Uplink whose suite only builds
    /// against this repo's private assemblies has not been made extractable, and
    /// the author who forks it inherits tests they cannot run. The Tests half has
    /// its own walk, its own plant, and its own pair of debt lists
    /// (<see cref="TestProjectReferenceDebt"/>, <see cref="TestProjectImportDebt"/>).</para>
    ///
    /// <para><b>Why this gates the REACHABLE set and not the declared one.</b>
    /// ProjectReference is transitive and nothing in this graph sets
    /// <c>PrivateAssets</c>, so a csproj naming one internal project gets that
    /// project's own references too. A guard counting csproj lines would score the
    /// widest breach as the mildest. Declared references are what an author
    /// edits; reachable assemblies are what the boundary actually is, so the debt is
    /// measured in the latter.</para>
    ///
    /// <para><b>Shrink-only, and strictly.</b> An entry may leave
    /// <see cref="ReferenceDebt"/> / <see cref="ImportDebt"/> only by the breach
    /// being fixed. A NEW breach fails, and so does a STALE entry: an Uplink listed
    /// here that no longer reaches the assembly it is excused for fails just as
    /// loudly, because a debt list nobody prunes stops describing anything. Both
    /// directions are asserted.</para>
    ///
    /// <para><b>The scan asserts it found its subjects.</b> A directory-walking gate
    /// whose walk silently returns nothing reports zero violations, which is
    /// indistinguishable from success and is the failure mode this repo keeps
    /// hitting. So <see cref="ScanFindsEveryUplinkProject"/> and
    /// <see cref="ScanFindsEveryUplinkTestProject"/> pin the discovery itself: the
    /// walk must find a planted Uplink and Tests project, and must agree exactly
    /// with <c>Gonogo.sln</c> in both directions, so a renamed or newly added one
    /// cannot quietly drop out of scope. None of it is a count, because every mod
    /// Uplink is leaving this repo and an empty set is where it ends. If the layout
    /// changes, those tests fail first and say so, rather than the isolation tests
    /// passing on an empty set.</para>
    /// </summary>
    public class UplinkIsolationTests
    {
        /// <summary>
        /// This repo's own projects that an Uplink may never build against. Anything
        /// under <c>mod/</c> that is not <c>Sitrep.Contract</c> or the Uplink's own
        /// <c>.Contract</c> slice is private by default; these are named explicitly
        /// so the failure message can say which one and so a new internal project
        /// joins the rule by being added here.
        /// </summary>
        private static readonly string[] PrivateProjects =
        {
            "Sitrep.Host",

            // Private to an Uplink PLUGIN, and only to one: see
            // ShippedToTestProjects. A plugin that carried its own copy would
            // shadow the one GonogoCore has already loaded into KSP's shared
            // AppDomain.
            "Sitrep.Core",

            "Sitrep.Transport",
            "Sitrep.Propagation",
            "Sitrep.CaptureAnalysis",
            "Sitrep.Skeleton",
            "Gonogo.KSP",

            // Private to an Uplink PLUGIN, and only to one: see
            // ShippedToTestProjects. It is net10.0 and carries an xunit.assert
            // dependency, so it is never in GameData and a plugin that reached it
            // would compile against something KSP cannot load.
            "Sitrep.Contract.TestSupport",
        };

        /// <summary>
        /// Projects in <see cref="PrivateProjects"/> that a <c>&lt;Uplink&gt;.Tests</c>
        /// project MAY reach, because an outside author has them too.
        ///
        /// <para>Both ship beside the vendored contract:
        /// <c>scripts/vendor-uplinks-reference-set.sh</c> builds them from the same
        /// gonogo commit as <c>Sitrep.Contract</c> and writes them to the
        /// gonogo-uplinks repo's <c>vendor/devkit</c>, where that repo's Tests
        /// projects reference them by HintPath, and the <c>net10.0</c> group of
        /// <c>KspGonogo.Sitrep.Contract</c> carries the same two. Neither is in
        /// GameData, which is why the plugin half still counts them private.</para>
        ///
        /// <para><c>Sitrep.Core</c> rides in behind
        /// <c>Sitrep.Contract.TestSupport</c>, which references it. A Tests project
        /// that wires a real Courier/Archive delay engine gets the engine rather
        /// than a double of it, and a change in core that breaks such a test is
        /// showing that Uplink work it was going to have to do.</para>
        ///
        /// <para>A name here never loosens the plugin gates, which read
        /// <see cref="PrivateProjects"/> unfiltered. Adding one is a claim that the
        /// vendoring script produces it.</para>
        /// </summary>
        private static readonly string[] ShippedToTestProjects =
        {
            "Sitrep.Contract.TestSupport",
            "Sitrep.Core",
        };

        private static readonly string[] TestProjectPrivateProjects =
            PrivateProjects.Except(ShippedToTestProjects, StringComparer.Ordinal).ToArray();

        /// <summary>
        /// Private assemblies each Uplink can still REACH, transitively, through the
        /// project references its csproj declares. Shrink only, and there is
        /// nothing left to shrink: every
        /// Uplink in this repo now compiles against <c>Sitrep.Contract</c> and its
        /// own contract slice alone.
        ///
        /// <para>The list stays, empty, rather than being deleted with the
        /// assertions that read it. It is the mechanism that keeps zero at zero: an
        /// Uplink that reaches a private assembly tomorrow fails rather than needing
        /// someone to notice, and the shape is here for the entry nobody has to add
        /// by hand.</para>
        /// </summary>
        private static readonly Dictionary<string, string[]> ReferenceDebt = new(StringComparer.Ordinal);

        /// <summary>
        /// Namespaces each Uplink still IMPORTS from a private assembly. Shrink only.
        ///
        /// <para>Deliberately separate from <see cref="ReferenceDebt"/>, because
        /// "we stopped importing it" and "we stopped depending on it" are different
        /// claims. Both are now empty, which is the only state in which an Uplink
        /// is done.</para>
        /// </summary>
        private static readonly Dictionary<string, string[]> ImportDebt = new(StringComparer.Ordinal);

        /// <summary>
        /// Private assemblies each <c>&lt;Uplink&gt;.Tests</c> project can still
        /// REACH. Shrink only, same rules as
        /// <see cref="ReferenceDebt"/>.
        ///
        /// <para>What an entry costs: that Uplink cannot leave. A Tests project is
        /// part of the Uplink it tests and moves with it, so an Uplink whose tests
        /// only compile against this repo's private assemblies has no green suite
        /// once it is extracted, and an author who forks it inherits a suite they
        /// cannot run. An entry here is a real breach being carried, never an
        /// exemption.</para>
        ///
        /// <para>Empty, and it stays here empty for the same reason
        /// <see cref="ReferenceDebt"/> does: the next Tests project to reach a
        /// private assembly fails on its own rather than waiting to be noticed.
        /// Anything that turns up here now needs either the capability route or a
        /// name in <see cref="ShippedToTestProjects"/>, and the second is a claim
        /// the vendoring script has to make true.</para>
        /// </summary>
        private static readonly Dictionary<string, string[]> TestProjectReferenceDebt =
            new(StringComparer.Ordinal);

        /// <summary>
        /// Namespaces each <c>&lt;Uplink&gt;.Tests</c> project still IMPORTS from a
        /// private assembly. Shrink only.
        ///
        /// <para>Separate from <see cref="TestProjectReferenceDebt"/> for the same
        /// reason the Uplink pair is separate: a reference that nothing imports is
        /// a line to delete, and an import is a type to relocate. They are not the
        /// same work and they do not clear together.</para>
        /// </summary>
        private static readonly Dictionary<string, string[]> TestProjectImportDebt =
            new(StringComparer.Ordinal);

        /// <summary>
        /// The isolation assertions in this file walk the set this proves, so a
        /// walk that finds nothing reports no violations and looks identical to a
        /// clean repo. See <see cref="UplinkProjects.AssertWalkAgreesWithPlantAndSolution"/>
        /// for why it holds at zero.
        /// </summary>
        [Fact]
        public void ScanFindsEveryUplinkProject()
        {
            UplinkProjects.AssertWalkAgreesWithPlantAndSolution(
                "Uplink",
                UplinkProjects.Discover,
                UplinkProjects.DeclaredInSolution,
                UplinkProjects.PlantedUplink);
        }

        /// <summary>
        /// The Tests half of <see cref="ScanFindsEveryUplinkProject"/>, and it
        /// exists for a sharper reason than symmetry: the Uplink walk excludes
        /// the <c>.Tests</c> siblings, and a gate told to skip a directory
        /// reports that directory clean. So the Tests walk has its own plant and
        /// its own exact agreement with <c>Gonogo.sln</c>.
        /// </summary>
        [Fact]
        public void ScanFindsEveryUplinkTestProject()
        {
            UplinkProjects.AssertWalkAgreesWithPlantAndSolution(
                "Uplink Tests",
                UplinkProjects.DiscoverTests,
                UplinkProjects.TestsDeclaredInSolution,
                UplinkProjects.PlantedUplinkTests);
        }

        /// <summary>
        /// An <c>&lt;Uplink&gt;.Tests</c> project is held to its Uplink's rule,
        /// because it is part of that Uplink: it names that Uplink's types, it
        /// compiles that Uplink's sources, and it goes with it when the Uplink
        /// leaves this repo. An Uplink whose suite only builds against
        /// <c>Sitrep.Host</c> has not been extracted, it has been split.
        /// </summary>
        [Fact]
        public void NoUplinkTestProjectReachesAPrivateProjectOutsideTheDebtList()
        {
            var tests = UplinkProjects.DiscoverTests();
            var graph = BuildProjectReferenceGraph();
            var failures = new List<string>();

            foreach (var (project, _) in tests.OrderBy(t => t.Key, StringComparer.Ordinal))
            {
                var reachable = ReachablePrivateProjects(project, graph, TestProjectPrivateProjects);
                var excused = TestProjectReferenceDebt.TryGetValue(project, out var debt)
                    ? new HashSet<string>(debt, StringComparer.Ordinal)
                    : new HashSet<string>(StringComparer.Ordinal);

                foreach (var reached in reachable.Except(excused).OrderBy(p => p, StringComparer.Ordinal))
                {
                    failures.Add(
                        $"{project} can build against {reached}, which is private and unpublished. " +
                        "A Tests project travels with the Uplink it tests, so this is the Uplink " +
                        "failing to be extractable, not a test-only convenience. Note this may be " +
                        "TRANSITIVE: check what the projects its csproj names pull in behind them.");
                }

                foreach (var stale in excused.Except(reachable).OrderBy(p => p, StringComparer.Ordinal))
                {
                    failures.Add(
                        $"{project} no longer reaches {stale}, but TestProjectReferenceDebt still " +
                        "excuses it. Delete that entry: this list is shrink-only.");
                }
            }

            AssertNoFailures(failures, "Tests-project reference");
        }

        [Fact]
        public void NoUplinkTestProjectImportsAPrivateNamespaceOutsideTheDebtList()
        {
            var tests = UplinkProjects.DiscoverTests();
            var failures = new List<string>();

            foreach (var (project, directory) in tests.OrderBy(t => t.Key, StringComparer.Ordinal))
            {
                var found = PrivateNamespaceImports(directory, TestProjectPrivateProjects);
                var excused = TestProjectImportDebt.TryGetValue(project, out var debt)
                    ? new HashSet<string>(debt, StringComparer.Ordinal)
                    : new HashSet<string>(StringComparer.Ordinal);

                foreach (var ns in found.Keys.Except(excused).OrderBy(n => n, StringComparer.Ordinal))
                {
                    failures.Add(
                        $"{project} imports {ns} (at {string.Join(", ", found[ns])}), which lives in a " +
                        "private assembly. If the helper genuinely belongs on the boundary, move it " +
                        "into Sitrep.Contract; if it is a host internal, the test needs the same " +
                        "route the Uplink itself would take.");
                }

                foreach (var stale in excused.Except(found.Keys).OrderBy(n => n, StringComparer.Ordinal))
                {
                    failures.Add(
                        $"{project} no longer imports {stale}, but TestProjectImportDebt still " +
                        "excuses it. Delete that entry: this list is shrink-only.");
                }
            }

            AssertNoFailures(failures, "Tests-project import");
        }

        [Fact]
        public void NoUplinkReachesAPrivateProjectOutsideTheDebtList()
        {
            var uplinks = UplinkProjects.Discover();
            var graph = BuildProjectReferenceGraph();
            var failures = new List<string>();

            foreach (var (uplink, _) in uplinks.OrderBy(u => u.Key, StringComparer.Ordinal))
            {
                var reachable = ReachablePrivateProjects(uplink, graph, PrivateProjects);
                var excused = ReferenceDebt.TryGetValue(uplink, out var debt)
                    ? new HashSet<string>(debt, StringComparer.Ordinal)
                    : new HashSet<string>(StringComparer.Ordinal);

                foreach (var project in reachable.Except(excused).OrderBy(p => p, StringComparer.Ordinal))
                {
                    failures.Add(
                        $"{uplink} can build against {project}, which is private and unpublished. " +
                        "Move what you need into Sitrep.Contract (a contract change is free) rather " +
                        "than referencing across the boundary. Note this may be TRANSITIVE: check " +
                        "what the projects its csproj names pull in behind them.");
                }

                foreach (var stale in excused.Except(reachable).OrderBy(p => p, StringComparer.Ordinal))
                {
                    failures.Add(
                        $"{uplink} no longer reaches {stale}, but ReferenceDebt still excuses it. " +
                        "Delete that entry: this list is shrink-only and an entry nobody prunes " +
                        "stops describing anything.");
                }
            }

            AssertNoFailures(failures, "reference");
        }

        /// <summary>
        /// The packaging half, and the reason it is a static check rather than an
        /// inspection of <c>bin/</c>: an incremental build reports whatever was left
        /// there last time. A gate that only tells the truth after
        /// <c>rm -rf bin obj</c> is a gate that will lie.
        ///
        /// <para>So the invariant is asserted on the thing that causes it. Every KSP
        /// GameData plugin loads into one AppDomain, so an Uplink shipping its own copy
        /// of a core assembly shadows core's. <c>Private=false</c> on an outer
        /// ProjectReference does not suppress copying of that project's OWN transitive
        /// references, which means a reachable project that the Uplink does not name
        /// itself gets copied. Naming every one of them, flagged, is the only thing
        /// that holds it.</para>
        ///
        /// <para>Note this is NOT subsumed by the isolation debt lists: an Uplink is
        /// allowed to be in <see cref="ReferenceDebt"/> while it pays down that debt,
        /// but it is never allowed to bundle what it reaches. The two gates
        /// fail for different reasons and an Uplink can fail this one alone.</para>
        ///
        /// <para>The <c>.Tests</c> siblings have no equivalent of this check and
        /// want none: a test assembly's <c>bin/</c> is never installed into
        /// GameData, so there is no shared AppDomain for it to shadow anything in.
        /// The reference and import gates apply to them, this one does not.</para>
        /// </summary>
        [Fact]
        public void NoUplinkBundlesAnAssemblyItMerelyReaches()
        {
            var uplinks = UplinkProjects.Discover();
            var graph = BuildProjectReferenceGraph();
            var failures = new List<string>();

            foreach (var (uplink, directory) in uplinks.OrderBy(u => u.Key, StringComparer.Ordinal))
            {
                var reachable = ReachablePrivateProjects(uplink, graph, PrivateProjects);
                var suppressed = NonCopyingDirectReferences(
                    Path.Combine(directory, uplink + ".csproj"));

                foreach (var project in reachable.Except(suppressed).OrderBy(p => p, StringComparer.Ordinal))
                {
                    failures.Add(
                        $"{uplink} can reach {project} but does not name it with Private=false, so it " +
                        "is copied into this Uplink's build output and would shadow core's copy in the " +
                        "shared AppDomain. Add an explicit ProjectReference with Private=false, even " +
                        "though nothing imports it: the reference exists to suppress the copy, not to " +
                        "compile.");
                }
            }

            AssertNoFailures(failures, "packaging");
        }

        [Fact]
        public void NoUplinkImportsAPrivateNamespaceOutsideTheDebtList()
        {
            var uplinks = UplinkProjects.Discover();
            var failures = new List<string>();

            foreach (var (uplink, directory) in uplinks.OrderBy(u => u.Key, StringComparer.Ordinal))
            {
                var found = PrivateNamespaceImports(directory, PrivateProjects);
                var excused = ImportDebt.TryGetValue(uplink, out var debt)
                    ? new HashSet<string>(debt, StringComparer.Ordinal)
                    : new HashSet<string>(StringComparer.Ordinal);

                foreach (var ns in found.Keys.Except(excused).OrderBy(n => n, StringComparer.Ordinal))
                {
                    failures.Add(
                        $"{uplink} imports {ns} (at {string.Join(", ", found[ns])}), which lives in a " +
                        "private assembly. If the type genuinely belongs on the boundary, move it into " +
                        "Sitrep.Contract; if it is a host internal, the Uplink needs a different route " +
                        "(register a provider on the Kernel against a capability id, the way the " +
                        "comms backends already do).");
                }

                foreach (var stale in excused.Except(found.Keys).OrderBy(n => n, StringComparer.Ordinal))
                {
                    failures.Add(
                        $"{uplink} no longer imports {stale}, but ImportDebt still excuses it. " +
                        "Delete that entry: this list is shrink-only.");
                }
            }

            AssertNoFailures(failures, "import");
        }

        private static void AssertNoFailures(List<string> failures, string kind)
        {
            Assert.True(
                failures.Count == 0,
                $"Uplink isolation ({kind}): an Uplink may build against Sitrep.Contract and its own " +
                ".Contract slice only. See docs/uplink-isolation.md.\n  " +
                string.Join("\n  ", failures));
        }

        /// <summary>Project name -> the project names its csproj references directly.</summary>
        private static Dictionary<string, HashSet<string>> BuildProjectReferenceGraph()
        {
            var modDir = UplinkProjects.ResolveModDir();
            var graph = new Dictionary<string, HashSet<string>>(StringComparer.Ordinal);
            var include = new Regex(@"ProjectReference\s+Include=""([^""]+)""", RegexOptions.Compiled);

            foreach (var directory in Directory.EnumerateDirectories(modDir))
            {
                var name = Path.GetFileName(directory);
                var csproj = Path.Combine(directory, name + ".csproj");
                if (!File.Exists(csproj))
                {
                    continue;
                }

                var references = new HashSet<string>(StringComparer.Ordinal);
                foreach (Match match in include.Matches(File.ReadAllText(csproj)))
                {
                    var referenced = Path.GetFileNameWithoutExtension(
                        match.Groups[1].Value.Replace('\\', '/'));
                    references.Add(referenced);
                }

                graph[name] = references;
            }

            return graph;
        }

        /// <summary>
        /// The projects a csproj references directly AND marks as non-copying. Both
        /// spellings are in use in this repo and mean the same thing: the attribute
        /// form <c>Private="false"</c> and the child-element form
        /// <c>&lt;Private&gt;false&lt;/Private&gt;</c>.
        /// </summary>
        private static HashSet<string> NonCopyingDirectReferences(string csprojPath)
        {
            var suppressed = new HashSet<string>(StringComparer.Ordinal);
            if (!File.Exists(csprojPath))
            {
                return suppressed;
            }

            var text = File.ReadAllText(csprojPath);

            // Self-closing with the attribute: <ProjectReference Include="..." Private="false" />
            var attributeForm = new Regex(
                @"<ProjectReference\s+Include=""([^""]+)""[^>]*?Private\s*=\s*""false""[^>]*/>",
                RegexOptions.Compiled | RegexOptions.IgnoreCase);

            // Element body: <ProjectReference Include="..."> <Private>false</Private> </ProjectReference>
            var elementForm = new Regex(
                @"<ProjectReference\s+Include=""([^""]+)""\s*>(.*?)</ProjectReference\s*>",
                RegexOptions.Compiled | RegexOptions.IgnoreCase | RegexOptions.Singleline);

            foreach (Match match in attributeForm.Matches(text))
            {
                suppressed.Add(ProjectNameFrom(match.Groups[1].Value));
            }

            foreach (Match match in elementForm.Matches(text))
            {
                if (Regex.IsMatch(match.Groups[2].Value, @"<Private>\s*false\s*</Private>",
                        RegexOptions.IgnoreCase))
                {
                    suppressed.Add(ProjectNameFrom(match.Groups[1].Value));
                }
            }

            return suppressed;
        }

        private static string ProjectNameFrom(string include) =>
            Path.GetFileNameWithoutExtension(include.Replace('\\', '/'));

        private static HashSet<string> ReachablePrivateProjects(
            string uplink, Dictionary<string, HashSet<string>> graph, IReadOnlyCollection<string> privateSet)
        {
            var privateProjects = new HashSet<string>(privateSet, StringComparer.Ordinal);
            var reached = new HashSet<string>(StringComparer.Ordinal);
            var seen = new HashSet<string>(StringComparer.Ordinal) { uplink };
            var pending = new Queue<string>();

            if (graph.TryGetValue(uplink, out var direct))
            {
                foreach (var reference in direct)
                {
                    pending.Enqueue(reference);
                }
            }

            while (pending.Count > 0)
            {
                var current = pending.Dequeue();
                if (!seen.Add(current))
                {
                    continue;
                }

                if (privateProjects.Contains(current))
                {
                    reached.Add(current);
                }

                if (graph.TryGetValue(current, out var next))
                {
                    foreach (var reference in next)
                    {
                        pending.Enqueue(reference);
                    }
                }
            }

            return reached;
        }

        /// <summary>
        /// Private namespace -> where it is imported. Matches <c>using</c> directives
        /// only, which is what a violation looks like in practice, but note it is not
        /// the whole story: C# can also reach a type through a fully-qualified name,
        /// an extension method, or (because every Uplink sits in <c>namespace
        /// Gonogo.*</c>) an unqualified <c>KSP.Foo</c> that binds to
        /// <c>Gonogo.KSP.Foo</c> through the enclosing namespace. The
        /// reference gate above is what actually holds that line: nothing can be
        /// reached by ANY of those routes without the assembly being reachable
        /// first, and that is asserted independently.
        /// </summary>
        private static Dictionary<string, List<string>> PrivateNamespaceImports(
            string directory, IReadOnlyCollection<string> privateSet)
        {
            var found = new Dictionary<string, List<string>>(StringComparer.Ordinal);
            var usingDirective = new Regex(@"^\s*using\s+(?:static\s+)?([A-Za-z0-9_.]+)\s*;", RegexOptions.Compiled);

            foreach (var file in Directory.EnumerateFiles(directory, "*.cs", SearchOption.AllDirectories))
            {
                var lines = File.ReadAllLines(file);
                for (var i = 0; i < lines.Length; i++)
                {
                    var match = usingDirective.Match(lines[i]);
                    if (!match.Success)
                    {
                        continue;
                    }

                    var imported = match.Groups[1].Value;
                    var owner = privateSet.FirstOrDefault(p =>
                        imported.Equals(p, StringComparison.Ordinal) ||
                        imported.StartsWith(p + ".", StringComparison.Ordinal));

                    if (owner is null)
                    {
                        continue;
                    }

                    if (!found.TryGetValue(imported, out var sites))
                    {
                        sites = new List<string>();
                        found[imported] = sites;
                    }

                    sites.Add($"{Path.GetFileName(file)}:{i + 1}");
                }
            }

            return found;
        }
    }
}
