using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using Xunit;

namespace Sitrep.Core.Tests
{
    /// <summary>
    /// The mod-side half of the Uplink isolation rule (<c>docs/uplink-isolation.md</c>,
    /// and <c>packages/core/src/uplink-isolation.test.ts</c> for the client half):
    /// an Uplink may build against <c>Sitrep.Contract</c> and its own
    /// <c>&lt;Uplink&gt;.Contract</c> slice, and nothing else of this repo's.
    /// <c>Sitrep.Host</c>, <c>Sitrep.Core</c>, <c>Sitrep.Transport</c>,
    /// <c>Sitrep.Propagation</c> and <c>Gonogo.KSP</c> are unpublished: an outside
    /// author can neither install nor build against them, so an Uplink that reaches
    /// into one has stopped being an example of what an outside author can write.
    /// There is no first-party exemption; shipping bundled with the mod changes how
    /// an Uplink is distributed, not what it may reference.
    ///
    /// <para><b>Why this gates the REACHABLE set and not the declared one.</b>
    /// ProjectReference is transitive and nothing in this graph sets
    /// <c>PrivateAssets</c>, so a csproj naming one internal project gets that
    /// project's own references too. The debt this was seeded with is what made the
    /// distinction worth encoding rather than assuming: GonogoKerbalismUplink
    /// declared exactly one internal project (<c>Gonogo.KSP</c>) and could compile
    /// against five, and did, it used a <c>Sitrep.Host</c> type it never declared a
    /// reference to. A guard counting csproj lines would have scored it the mildest
    /// of the breaches instead of the widest. Declared references are what an author
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
    /// hitting. So <see cref="ScanFindsEveryUplinkProject"/> pins the discovery
    /// itself: the Uplinks it must find by name, and a floor on the count so a
    /// renamed or newly added one cannot quietly drop out of scope. If the layout
    /// changes, that test fails first and says so, rather than the isolation tests
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
            "Sitrep.Core",
            "Sitrep.Transport",
            "Sitrep.Propagation",
            "Sitrep.CaptureAnalysis",
            "Sitrep.Skeleton",
            "Gonogo.KSP",
        };

        private const int MinimumUplinkProjectCount = 9;

        /// <summary>
        /// Private assemblies each Uplink can still REACH, transitively, through the
        /// project references its csproj declares. Seeded 2026-08-19, EMPTIED
        /// 2026-08-20. Shrink only, and there is nothing left to shrink: every
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
        /// Namespaces each Uplink still IMPORTS from a private assembly. Seeded
        /// 2026-08-19, EMPTIED 2026-08-20. Shrink only.
        ///
        /// <para>Deliberately separate from <see cref="ReferenceDebt"/>, because
        /// "we stopped importing it" and "we stopped depending on it" are different
        /// claims and the mod side was failing them in different places: five
        /// references were dropped in the seeding commit purely because nothing
        /// imported them, and the imports that remained were real. Both are now
        /// empty, which is the only state in which an Uplink is done.</para>
        /// </summary>
        private static readonly Dictionary<string, string[]> ImportDebt = new(StringComparer.Ordinal);

        [Fact]
        public void ScanFindsEveryUplinkProject()
        {
            var uplinks = DiscoverUplinkProjects();

            Assert.True(
                uplinks.Count >= MinimumUplinkProjectCount,
                $"The Uplink scan found {uplinks.Count} project(s), expected at least " +
                $"{MinimumUplinkProjectCount}. The isolation assertions in this file walk the same " +
                "set, so a scan that finds nothing reports no violations and looks identical to a " +
                "clean repo. Either the mod/ layout moved (fix ResolveModDir/DiscoverUplinkProjects) " +
                "or Uplinks were removed (lower the floor deliberately). Found: " +
                string.Join(", ", uplinks.Keys.OrderBy(k => k, StringComparer.Ordinal)));

            var declared = UplinkProjectsDeclaredInSolution();
            Assert.True(
                declared.Count >= MinimumUplinkProjectCount,
                $"Gonogo.sln declares only {declared.Count} Uplink project(s). This is the " +
                "independent source the directory walk is checked against, so if it comes back " +
                "empty the check below compares nothing to nothing and passes.");

            var missing = declared.Except(uplinks.Keys).OrderBy(n => n, StringComparer.Ordinal).ToList();
            Assert.True(
                missing.Count == 0,
                "Gonogo.sln declares Uplink projects the directory walk did not find: " +
                string.Join(", ", missing) +
                ". Either the walk is broken or a project was removed from disk but left in the " +
                "solution.");
        }

        [Fact]
        public void NoUplinkReachesAPrivateProjectOutsideTheDebtList()
        {
            var uplinks = DiscoverUplinkProjects();
            var graph = BuildProjectReferenceGraph();
            var failures = new List<string>();

            foreach (var (uplink, _) in uplinks.OrderBy(u => u.Key, StringComparer.Ordinal))
            {
                var reachable = ReachablePrivateProjects(uplink, graph);
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
        /// there last time. A stale <c>bin/</c> was read once while measuring this and
        /// said GonogoKerbalismUplink bundled nothing, when a clean build bundled four
        /// of core's assemblies. A gate that only tells the truth after
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
        /// allowed to be in <see cref="ReferenceDebt"/> while it works through a
        /// ruling, but it is never allowed to bundle what it reaches. The two gates
        /// fail for different reasons and an Uplink can fail this one alone.</para>
        /// </summary>
        [Fact]
        public void NoUplinkBundlesAnAssemblyItMerelyReaches()
        {
            var uplinks = DiscoverUplinkProjects();
            var graph = BuildProjectReferenceGraph();
            var failures = new List<string>();

            foreach (var (uplink, directory) in uplinks.OrderBy(u => u.Key, StringComparer.Ordinal))
            {
                var reachable = ReachablePrivateProjects(uplink, graph);
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
            var uplinks = DiscoverUplinkProjects();
            var failures = new List<string>();

            foreach (var (uplink, directory) in uplinks.OrderBy(u => u.Key, StringComparer.Ordinal))
            {
                var found = PrivateNamespaceImports(directory);
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

        /// <summary>
        /// The Uplink projects <c>Gonogo.sln</c> declares. The solution is a source
        /// independent of the directory walk, which is the point: a walk checked
        /// against a list hardcoded here would only ever confirm that someone
        /// remembered to edit the list. It also keeps this file free of Uplink name
        /// literals, which the client-side uplink-boundary ratchet scans for outside
        /// each Uplink's owning directory, and this file is outside all of them.
        /// </summary>
        private static HashSet<string> UplinkProjectsDeclaredInSolution()
        {
            var solution = Path.Combine(ResolveModDir(), "Gonogo.sln");
            var declared = new HashSet<string>(StringComparer.Ordinal);
            if (!File.Exists(solution))
            {
                return declared;
            }

            var project = new Regex(@"=\s*""([A-Za-z0-9_.]+Uplink)""", RegexOptions.Compiled);
            foreach (Match match in project.Matches(File.ReadAllText(solution)))
            {
                declared.Add(match.Groups[1].Value);
            }

            return declared;
        }

        /// <summary>Uplink project name -> its source directory. An Uplink is a
        /// <c>Gonogo*Uplink</c> directory with a csproj; the <c>.Contract</c> and
        /// <c>.Tests</c> siblings are not Uplinks and are excluded.</summary>
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

        /// <summary>Project name -> the project names its csproj references directly.</summary>
        private static Dictionary<string, HashSet<string>> BuildProjectReferenceGraph()
        {
            var modDir = ResolveModDir();
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
            string uplink, Dictionary<string, HashSet<string>> graph)
        {
            var privateProjects = new HashSet<string>(PrivateProjects, StringComparer.Ordinal);
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
        /// <c>Gonogo.KSP.Foo</c> through the enclosing namespace. Those were all
        /// scanned for by hand when this gate was seeded and none was found. The
        /// reference gate above is what actually holds that line: nothing can be
        /// reached by ANY of those routes without the assembly being reachable
        /// first, and that is asserted independently.
        /// </summary>
        private static Dictionary<string, List<string>> PrivateNamespaceImports(string directory)
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
                    var owner = PrivateProjects.FirstOrDefault(p =>
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

        /// <summary>
        /// Walks up from the test assembly to the checked-out <c>mod/</c> directory,
        /// same pattern as <see cref="UplinkContractOwnershipTests"/>.
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
