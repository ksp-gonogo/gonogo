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
    /// <para><b>The <c>&lt;Uplink&gt;.Tests</c> siblings are in scope too, since
    /// 2026-08-30.</b> They were not, and that is how every debt list here read
    /// zero while ten of the twelve Uplinks were breaching the rule: the walk
    /// skipped the directory the breach lived in, and a gate told to skip a
    /// directory reports it clean. A Tests project is part of the Uplink it tests,
    /// it names that Uplink's types and compiles that Uplink's sources, so it moves
    /// with the Uplink when the Uplink leaves. An Uplink whose suite only builds
    /// against this repo's private assemblies has not been made extractable, and
    /// the author who forks it inherits tests they cannot run. The Tests half has
    /// its own walk, its own floor, and its own pair of debt lists
    /// (<see cref="TestProjectReferenceDebt"/>, <see cref="TestProjectImportDebt"/>),
    /// seeded from measurement rather than assumed empty.</para>
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

            // Private despite the name. Sitrep.Contract.TestSupport is
            // IsPackable=false and net10.0-only, so it is not in the box a
            // third-party author installs and there is no target framework of it
            // they could reference if it were. An Uplink's Tests project that
            // needs it cannot be built outside this repo, which is the whole
            // question these gates ask.
            "Sitrep.Contract.TestSupport",
        };

        private const int MinimumUplinkProjectCount = 9;

        private const int MinimumUplinkTestProjectCount = 10;

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

        /// <summary>
        /// Private assemblies each <c>&lt;Uplink&gt;.Tests</c> project can still
        /// REACH. Seeded 2026-08-30, when the Tests projects were brought into
        /// scope for the first time. Shrink only, same rules as
        /// <see cref="ReferenceDebt"/>.
        ///
        /// <para>What an entry costs: that Uplink cannot leave. A Tests project is
        /// part of the Uplink it tests and moves with it, so an Uplink whose tests
        /// only compile against this repo's private assemblies has no green suite
        /// once it is extracted, and an author who forks it inherits a suite they
        /// cannot run. Every entry below is a real breach being carried, not an
        /// exemption.</para>
        ///
        /// <para><c>Sitrep.Contract.TestSupport</c> dominates the list and is the
        /// cheapest to clear in principle (it is contract-only code that nothing
        /// stops from being published) and the most expensive to leave (it is what
        /// makes ten of the twelve unextractable). The others are genuine reaches
        /// into host internals and need the capability route instead.</para>
        /// </summary>
        private static readonly Dictionary<string, string[]> TestProjectReferenceDebt =
            new(StringComparer.Ordinal)
            {
                // Sitrep.Host for ChannelEngine/UplinkDiscovery and the
                // Sitrep.Host.ActionGroups seam. Core/Transport/Propagation arrive
                // behind it and are not named in the csproj at all, which is the
                // transitive case this gate exists to see.
                ["GonogoActionGroupsExtendedUplink.Tests"] = new[]
                {
                    "Sitrep.Contract.TestSupport",
                    "Sitrep.Core",
                    "Sitrep.Host",
                    "Sitrep.Propagation",
                    "Sitrep.Transport",
                },

                // The Unit-coverage assertion only. Clears the day TestSupport
                // ships, no source change needed here.
                ["GonogoFerramAerospaceResearchUplink.Tests"] = new[] { "Sitrep.Contract.TestSupport" },
                ["GonogoMechJebUplink.Tests"] = new[] { "Sitrep.Contract.TestSupport" },

                // Sitrep.Core for EnvelopeCodec, to assert what an extension puts
                // on the wire. An author outside this repo has no encoder to
                // assert against, so these are wire tests that cannot travel.
                ["GonogoKerbalismUplink.Tests"] = new[]
                {
                    "Sitrep.Contract.TestSupport",
                    "Sitrep.Core",
                },
                ["GonogoRealAntennasUplink.Tests"] = new[]
                {
                    "Sitrep.Contract.TestSupport",
                    "Sitrep.Core",
                },

                // Sitrep.Host for the extension-discovery and headless-terminal
                // harnesses, Sitrep.Core for the courier/reveal internals, and the
                // rest transitively behind Host.
                ["GonogoKosUplink.Tests"] = new[]
                {
                    "Sitrep.Contract.TestSupport",
                    "Sitrep.Core",
                    "Sitrep.Host",
                    "Sitrep.Propagation",
                    "Sitrep.Transport",
                },

                // Sitrep.Host for the Economy and Crew starvation probes, and the
                // rest transitively behind it.
                ["GonogoRp1Uplink.Tests"] = new[]
                {
                    "Sitrep.Contract.TestSupport",
                    "Sitrep.Core",
                    "Sitrep.Host",
                    "Sitrep.Propagation",
                    "Sitrep.Transport",
                },

                // Absent, and deliberately: GonogoPrincipiaUplink.Tests and
                // GonogoTestFlightUplink.Tests reach nothing private. They are the
                // proof this is achievable and the shape the other ten owe.
            };

        /// <summary>
        /// Namespaces each <c>&lt;Uplink&gt;.Tests</c> project still IMPORTS from a
        /// private assembly. Seeded 2026-08-30. Shrink only.
        ///
        /// <para>Separate from <see cref="TestProjectReferenceDebt"/> for the same
        /// reason the Uplink pair is separate: a reference that nothing imports is
        /// a line to delete, and an import is a type to relocate. They are not the
        /// same work and they do not clear together.</para>
        /// </summary>
        private static readonly Dictionary<string, string[]> TestProjectImportDebt =
            new(StringComparer.Ordinal)
            {
                ["GonogoActionGroupsExtendedUplink.Tests"] = new[]
                {
                    "Sitrep.Contract.TestSupport",
                    "Sitrep.Host",
                    "Sitrep.Host.ActionGroups",
                },
                ["GonogoFerramAerospaceResearchUplink.Tests"] = new[] { "Sitrep.Contract.TestSupport" },
                ["GonogoKerbalismUplink.Tests"] = new[]
                {
                    "Sitrep.Contract.TestSupport",
                    "Sitrep.Core.Serialization",
                },
                ["GonogoKosUplink.Tests"] = new[]
                {
                    "Sitrep.Contract.TestSupport",
                    "Sitrep.Core",
                    "Sitrep.Host",
                },
                ["GonogoMechJebUplink.Tests"] = new[] { "Sitrep.Contract.TestSupport" },
                ["GonogoRealAntennasUplink.Tests"] = new[]
                {
                    "Sitrep.Contract.TestSupport",
                    "Sitrep.Core.Serialization",
                },
                ["GonogoRp1Uplink.Tests"] = new[]
                {
                    "Sitrep.Contract.TestSupport",
                    "Sitrep.Host.Crew",
                    "Sitrep.Host.Economy",
                },
            };

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

        /// <summary>
        /// The Tests half of <see cref="ScanFindsEveryUplinkProject"/>, and it
        /// exists for a sharper reason than symmetry. Every debt list in this file
        /// read zero for ten days while ten Uplinks were breaching the rule,
        /// because <see cref="DiscoverUplinkProjects"/> excludes the <c>.Tests</c>
        /// siblings and nothing else looked at them. A gate told to skip a
        /// directory reports that directory clean. So the Tests walk is pinned
        /// against <c>Gonogo.sln</c> too, and a floor keeps a broken walk from
        /// passing as an empty one.
        /// </summary>
        [Fact]
        public void ScanFindsEveryUplinkTestProject()
        {
            var tests = DiscoverUplinkTestProjects();

            Assert.True(
                tests.Count >= MinimumUplinkTestProjectCount,
                $"The Uplink Tests scan found {tests.Count} project(s), expected at least " +
                $"{MinimumUplinkTestProjectCount}. The Tests isolation assertions walk this set, so " +
                "a walk that finds nothing reports no violations and is indistinguishable from a " +
                "clean repo. Found: " +
                string.Join(", ", tests.Keys.OrderBy(k => k, StringComparer.Ordinal)));

            var declared = UplinkTestProjectsDeclaredInSolution();
            Assert.True(
                declared.Count >= MinimumUplinkTestProjectCount,
                $"Gonogo.sln declares only {declared.Count} Uplink Tests project(s). This is the " +
                "independent source the directory walk is checked against, so if it comes back " +
                "empty the check below compares nothing to nothing and passes.");

            var missing = declared.Except(tests.Keys).OrderBy(n => n, StringComparer.Ordinal).ToList();
            Assert.True(
                missing.Count == 0,
                "Gonogo.sln declares Uplink Tests projects the directory walk did not find: " +
                string.Join(", ", missing) +
                ". Either the walk is broken or a project was removed from disk but left in the " +
                "solution.");
        }

        /// <summary>
        /// An <c>&lt;Uplink&gt;.Tests</c> project is held to its Uplink's rule,
        /// because it is part of that Uplink: it names that Uplink's types, it
        /// compiles that Uplink's sources, and it goes with it when the Uplink
        /// leaves this repo. An Uplink whose suite only builds against
        /// <c>Sitrep.Host</c> has not been extracted, it has been split.
        ///
        /// <para><b>The planted-failure demonstration.</b> Run 2026-08-30, all
        /// three plants on <c>GonogoTestFlightUplink.Tests</c>, the project this
        /// file excuses nothing for. Adding
        /// <c>&lt;ProjectReference Include="..\Sitrep.Core\Sitrep.Core.csproj" /&gt;</c>
        /// to its csproj, and a one-line
        /// <c>PlantedIsolationBreach.cs</c> holding <c>using Sitrep.Core.Serialization;</c>,
        /// turned both Tests gates red and named the project and the site:</para>
        /// <code>
        /// GonogoTestFlightUplink.Tests can build against Sitrep.Core, which is private and
        /// unpublished. ...
        /// GonogoTestFlightUplink.Tests imports Sitrep.Core.Serialization (at
        /// PlantedIsolationBreach.cs:1), which lives in a private assembly. ...
        /// </code>
        /// <para>The stale half was planted separately, by excusing
        /// <c>Sitrep.Core</c> for that project while it reached nothing:</para>
        /// <code>
        /// GonogoTestFlightUplink.Tests no longer reaches Sitrep.Core, but
        /// TestProjectReferenceDebt still excuses it. Delete that entry: this list is
        /// shrink-only.
        /// </code>
        /// <para>All three were then removed and the suite went green again. The
        /// clean run is as much of the demonstration as the red ones: a gate that
        /// fails at everything proves nothing about its subject.</para>
        /// </summary>
        [Fact]
        public void NoUplinkTestProjectReachesAPrivateProjectOutsideTheDebtList()
        {
            var tests = DiscoverUplinkTestProjects();
            var graph = BuildProjectReferenceGraph();
            var failures = new List<string>();

            foreach (var (project, _) in tests.OrderBy(t => t.Key, StringComparer.Ordinal))
            {
                var reachable = ReachablePrivateProjects(project, graph);
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
            var tests = DiscoverUplinkTestProjects();
            var failures = new List<string>();

            foreach (var (project, directory) in tests.OrderBy(t => t.Key, StringComparer.Ordinal))
            {
                var found = PrivateNamespaceImports(directory);
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
        ///
        /// <para>The <c>.Tests</c> siblings have no equivalent of this check and
        /// want none: a test assembly's <c>bin/</c> is never installed into
        /// GameData, so there is no shared AppDomain for it to shadow anything in.
        /// The reference and import gates apply to them, this one does not.</para>
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

        /// <summary>
        /// The <c>&lt;Uplink&gt;.Tests</c> projects <c>Gonogo.sln</c> declares, the
        /// independent source <see cref="DiscoverUplinkTestProjects"/> is checked
        /// against. Same reasoning as
        /// <see cref="UplinkProjectsDeclaredInSolution"/>, and the two regexes do
        /// not overlap: that one anchors on <c>Uplink"</c>, this one on
        /// <c>Uplink.Tests"</c>.
        /// </summary>
        private static HashSet<string> UplinkTestProjectsDeclaredInSolution()
        {
            var solution = Path.Combine(ResolveModDir(), "Gonogo.sln");
            var declared = new HashSet<string>(StringComparer.Ordinal);
            if (!File.Exists(solution))
            {
                return declared;
            }

            var project = new Regex(@"=\s*""([A-Za-z0-9_.]+Uplink\.Tests)""", RegexOptions.Compiled);
            foreach (Match match in project.Matches(File.ReadAllText(solution)))
            {
                declared.Add(match.Groups[1].Value);
            }

            return declared;
        }

        /// <summary>Uplink project name -> its source directory. An Uplink is a
        /// <c>Gonogo*Uplink</c> directory with a csproj; the <c>.Contract</c> and
        /// <c>.Tests</c> siblings are not Uplinks and are excluded. The Tests
        /// siblings get their own walk (<see cref="DiscoverUplinkTestProjects"/>)
        /// and are held to the same rule from there.</summary>
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

        /// <summary>
        /// Uplink Tests project name -> its source directory. A
        /// <c>Gonogo*Uplink.Tests</c> directory with a csproj. The
        /// <c>.Contract.Codegen</c> siblings do not match and neither do the plain
        /// Uplink directories.
        /// </summary>
        private static Dictionary<string, string> DiscoverUplinkTestProjects()
        {
            var modDir = ResolveModDir();
            var tests = new Dictionary<string, string>(StringComparer.Ordinal);

            foreach (var directory in Directory.EnumerateDirectories(modDir))
            {
                var name = Path.GetFileName(directory);
                if (!name.StartsWith("Gonogo", StringComparison.Ordinal) ||
                    !name.EndsWith("Uplink.Tests", StringComparison.Ordinal))
                {
                    continue;
                }

                if (File.Exists(Path.Combine(directory, name + ".csproj")))
                {
                    tests[name] = directory;
                }
            }

            return tests;
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
