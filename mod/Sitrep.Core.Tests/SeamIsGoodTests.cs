using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text.RegularExpressions;
using Sitrep.Contract;
using Sitrep.Contract.TestSupport;
using Xunit;

namespace Sitrep.Core.Tests
{
    /// <summary>
    /// A seam is good when the repo itself tells an outside implementer both halves
    /// of the job. WHAT to provide: a doc comment on the interface and on every
    /// member it declares. HOW TO KNOW they provided it right: a conformance
    /// assertion in the shipped <c>Sitrep.Contract.TestSupport</c> that accepts the
    /// seam's own type, or a base of it.
    ///
    /// <para><b>This file used to ask a different question, and the difference is
    /// the point.</b> It asked whether a seam had a production implementer IN THIS
    /// REPO, and failed one that did not. That is the wrong question now, because a
    /// seam is a future integration point for an Uplink nobody has written yet: an
    /// OPEN seam is legitimate, and holding one to an in-repo implementer would have
    /// blocked five seams the moment the Uplinks holding them left this repo.
    /// <c>IDerivedCurrencyWithholder</c>, <c>IScetThresholdSources</c>,
    /// <c>IGravityModelSource</c>, <c>IIntegratedTrajectorySource</c> and
    /// <c>IBodyEphemerisHorizon</c> each have exactly one implementer and it is an
    /// Uplink that is on its way out. Which Uplinks is deliberately not written
    /// here: nothing in core names a mod.</para>
    ///
    /// <para><b>Two lists, and only one of them is allowed. Read this before adding
    /// either.</b> An IMPLEMENTER list is banned outright: recording who implements a
    /// seam invites deleting a seam that looks unused here while a third party is
    /// building on it, and nothing in this repo can see that party. A CONFORMANCE
    /// debt list is allowed, and <see cref="ConformanceDebt"/> is one: it records
    /// documentation this repo still owes, so the only thing it can ever do is make
    /// skipping that work harder. It cannot make an implementation easier to
    /// delete, because it says nothing about implementations.</para>
    ///
    /// <para><b>Which interfaces are seams is DERIVED, not listed.</b> An Uplink may
    /// reference <c>Sitrep.Contract</c> and nothing else of this repo's (see
    /// docs/uplink-isolation.md), so the public interfaces of that one assembly are
    /// exactly the set an outside party can implement or call. A 37th joins by being
    /// declared. Everything else (<c>Sitrep.Host</c>'s, <c>Sitrep.Core</c>'s,
    /// <c>Sitrep.Transport</c>'s) is an internal collaborator nobody outside can
    /// name, so "is it good for an outside implementer" is not a question about it
    /// and the OLD check still applies there unchanged: see
    /// <see cref="EveryInterfaceInAPrivateAssemblyHasAProductionImplementer"/>.</para>
    ///
    /// <para><b>How this still catches the original incident.</b>
    /// <c>IIntegratedTrajectorySource</c> shipped with a declaration, a single
    /// <c>is</c> check and zero implementers, so the n-body horizon reported
    /// closed-form on every live frame while every test of the integrator behind it
    /// passed, because each of those tests opened the gate by hand. The absent
    /// implementer is now legitimate. What is not legitimate is the hand-opened
    /// gate: a seam passes only when there is a SHARED, SHIPPED assertion that takes
    /// an implementation and says whether it is right. This repo's own tests then
    /// open the gate through that same assertion, so "the code behind the gate
    /// works" and "somebody else's implementation would get through it" stop being
    /// two different claims with only the first one checked.</para>
    ///
    /// <para><b>Source text for the private half, reflection for the public half.</b>
    /// <c>Gonogo.sln</c> omits the projects needing the KSP managed assemblies, so a
    /// reflection scan cannot see <c>Gonogo.KSP</c> or any Uplink and would report
    /// their interfaces as unimplemented. The public half has the opposite problem
    /// and the opposite answer: what an author gets is the ASSEMBLY and the XML doc
    /// beside it, so those are what is read.</para>
    ///
    /// <para><b>Every half is made to see a violation.</b> Each audit below is a pure
    /// function over its inputs, and <see cref="TheChecksSeeAPlantedViolation"/>
    /// feeds each one an input that must fail. A check that cannot see its own
    /// failure reports zero, and zero reads as success.</para>
    /// </summary>
    public class SeamIsGoodTests
    {
        /// <summary>
        /// Seams with no conformance assertion in <c>Sitrep.Contract.TestSupport</c>
        /// yet. Seeded 2026-09-16, SHRINK ONLY.
        ///
        /// <para>An entry leaves by someone writing the assertion, which is a real
        /// piece of work per seam: reading what that interface promises and turning
        /// it into something an implementer can run. An assertion that asserts
        /// nothing is worse than none, because it reads as coverage.</para>
        ///
        /// <para>The 20 seams deriving from <see cref="ISitrepProvider"/> are absent
        /// from this list and always were: one assertion covers all of them through
        /// inheritance, which is what a shared base interface is for.</para>
        /// </summary>
        private static readonly Dictionary<string, string> ConformanceDebt = new(StringComparer.Ordinal)
        {
            ["ICommsDegradeModel"] = "what a degrade curve owes: monotonicity, and its behaviour at and beyond the endpoints",
            ["ICommsOcclusionModel"] = "whether an occlusion answer is symmetric in its two endpoints, and what it returns when a body is not between them",
            ["ICommsReachModel"] = "the units and the null rule on a reach answer, and that it does not depend on call order",
            ["IGateArguments"] = "what a gate argument must expose for every shipped evaluator kind to read it",
            ["ICommandGateEvaluator"] = "that an evaluator answers only for its own kind, and refuses rather than throws on an argument it cannot read",
            ["ISnapshotSampler"] = "that a sampler is pure with respect to the snapshot it is handed, and what it may return when it has nothing",
            ["IChannelPublisher"] = "publish-after-dispose, publishing null, and whether a publisher may be held across a tick",
            ["IDynamicChannelSource"] = "that the topic set a source names is stable within a tick, and what a vanished topic does",
            ["IUplinkHost"] = "the registration-order rules a host must honour, and which calls are legal after startup",
            ["IUplinkCapabilityDeclarer"] = "that a declared capability id is one the Kernel can resolve, and what a duplicate declaration does",
            ["IIntegratedTrajectorySource"] = "what an integrated trajectory owes over a span: frame, epoch monotonicity, and the refusal shape when the span is not certified",
            ["ISeededPropagationProvider"] = "that a seeded propagation agrees with the unseeded one at the seed instant",
            ["IBodyEphemerisHorizon"] = "the meaning of the horizon instant, and what is returned when the ephemeris does not reach that far",
            ["ICommandCentre"] = "the vantage id vocabulary and its stability across a save/load",
            ["ITrajectoryArcSource"] = "arc continuity across a patch boundary, and the null rule when no arc can be produced",
        };

        // ── The public half: is the seam good ────────────────────────────────────

        /// <summary>
        /// Every public interface of <c>Sitrep.Contract</c>, which is the whole set
        /// an outside author can reach.
        /// </summary>
        private static IReadOnlyList<Type> PublicSeams() =>
            typeof(ISitrepProvider).Assembly
                .GetTypes()
                .Where(t => t.IsInterface && t.IsPublic)
                .OrderBy(t => t.Name, StringComparer.Ordinal)
                .ToList();

        [Fact]
        public void EveryPublicSeamIsDocumented()
        {
            var undocumented = UndocumentedSeams(PublicSeams(), DocumentedKeys());

            Assert.True(
                undocumented.Count == 0,
                "These seams are part of the published contract and do not say what an "
                + "implementer is supposed to provide. An outside author has the assembly, "
                + "this XML file and nothing else:\n  "
                + string.Join("\n  ", undocumented));
        }

        [Fact]
        public void EveryPublicSeamHasAConformanceAssertion()
        {
            var uncovered = SeamsWithoutAConformanceAssertion(PublicSeams(), AssertedParameterTypes())
                .Select(t => t.Name)
                .ToList();

            var undeclared = uncovered.Where(n => !ConformanceDebt.ContainsKey(n)).ToList();

            Assert.True(
                undeclared.Count == 0,
                "These seams have no conformance assertion in Sitrep.Contract.TestSupport, so "
                + "an implementer has no way to find out whether they got it right and this "
                + "repo's own tests can only open the gate by hand: "
                + string.Join(", ", undeclared));
        }

        [Fact]
        public void EveryConformanceDebtEntryIsStillOwed()
        {
            var asserted = AssertedParameterTypes();
            var seams = PublicSeams();

            var covered = ConformanceDebt.Keys
                .Where(name => seams.Any(
                    t => t.Name == name && asserted.Any(p => p.IsAssignableFrom(t))))
                .OrderBy(n => n, StringComparer.Ordinal)
                .ToList();

            Assert.True(
                covered.Count == 0,
                "These seams now HAVE a conformance assertion and must leave ConformanceDebt, "
                + "so the list keeps describing the real state: " + string.Join(", ", covered));

            var vanished = ConformanceDebt.Keys
                .Where(name => seams.All(t => t.Name != name))
                .ToList();

            Assert.True(
                vanished.Count == 0,
                "These ConformanceDebt entries name a seam the contract no longer declares; "
                + "remove them: " + string.Join(", ", vanished));
        }

        // ── The private half: the old check, still right where it applies ────────

        [Fact]
        public void EveryInterfaceInAPrivateAssemblyHasAProductionImplementer()
        {
            var graph = Scan();

            var unimplemented = graph.ProductionInterfaces
                .Where(pair => !pair.Value.StartsWith("Sitrep.Contract/", StringComparison.Ordinal))
                .Select(pair => pair.Key)
                .Where(name => !graph.Satisfied.Contains(name))
                .OrderBy(name => name, StringComparer.Ordinal)
                .ToList();

            Assert.True(
                unimplemented.Count == 0,
                "These interfaces are declared in an assembly no Uplink may reference, so there "
                + "is no third party who could be implementing them, and nothing in production "
                + "implements them here either: whatever they gate cannot run.\n  "
                + string.Join(
                    "\n  ",
                    unimplemented.Select(n => n + "  declared at " + graph.ProductionInterfaces[n])));
        }

        // ── The audits, pure so they can be handed a planted failure ─────────────

        /// <summary>
        /// A seam is documented when the XML doc carries an entry for the type AND
        /// for every member the interface declares itself. Inherited members belong
        /// to the base that declares them and are checked when that base is.
        /// </summary>
        internal static IReadOnlyList<string> UndocumentedSeams(
            IReadOnlyList<Type> seams, ISet<string> documentedKeys)
        {
            var missing = new List<string>();

            foreach (var seam in seams)
            {
                if (!documentedKeys.Contains("T:" + seam.FullName))
                {
                    missing.Add(seam.Name + " (the interface itself)");
                }

                foreach (var member in seam.GetMembers(
                    BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly))
                {
                    // A property's accessors are members too and are never documented
                    // separately; the property's own entry is the documentation.
                    if (member is MethodInfo method && method.IsSpecialName)
                    {
                        continue;
                    }

                    var prefix = member switch
                    {
                        PropertyInfo => "P:",
                        EventInfo => "E:",
                        _ => "M:",
                    };
                    var key = prefix + seam.FullName + "." + member.Name;
                    if (!documentedKeys.Any(k => k.StartsWith(key, StringComparison.Ordinal)))
                    {
                        missing.Add(seam.Name + "." + member.Name);
                    }
                }
            }

            return missing;
        }

        /// <summary>
        /// A seam is covered when some public entry point of the TestSupport assembly
        /// takes a parameter the seam is assignable to. That is what makes the
        /// <see cref="ISitrepProvider"/> assertion cover every capability seam
        /// deriving from it without an entry each.
        /// </summary>
        internal static IReadOnlyList<Type> SeamsWithoutAConformanceAssertion(
            IReadOnlyList<Type> seams, IReadOnlyList<Type> assertedParameterTypes) =>
            seams.Where(t => !assertedParameterTypes.Any(p => p.IsAssignableFrom(t))).ToList();

        // ── Reading the inputs ───────────────────────────────────────────────────

        /// <summary>
        /// Every <c>name="..."</c> key in the contract's generated XML doc, read from
        /// beside the assembly because that pair is exactly what an outside author
        /// installs.
        /// </summary>
        private static ISet<string> DocumentedKeys()
        {
            var assembly = typeof(ISitrepProvider).Assembly;
            var xml = Path.ChangeExtension(assembly.Location, ".xml");

            Assert.True(
                File.Exists(xml),
                "No XML doc beside " + assembly.Location + ". Sitrep.Contract sets "
                + "GenerateDocumentationFile and KspGonogo.Sitrep.Contract packs the result, so "
                + "its absence is a build regression, not a reason to skip: without it this "
                + "check would report every seam documented.");

            return new HashSet<string>(
                Regex.Matches(File.ReadAllText(xml), @"<member name=""([^""]+)""")
                    .Select(m => m.Groups[1].Value),
                StringComparer.Ordinal);
        }

        /// <summary>
        /// The contract interfaces the shipped TestSupport assembly ASSERTS ABOUT: the
        /// parameter types of its public static helpers.
        ///
        /// <para>Two narrowings, and both were earned. Only interfaces declared in
        /// <c>Sitrep.Contract</c> count, because a parameter typed <c>object</c> or
        /// <c>Type</c> would otherwise "cover" seams it has nothing to say about. And
        /// only STATIC methods on a type that does not itself implement a contract
        /// interface count, because TestSupport's other half is test DOUBLES
        /// (<c>ClockedUplinkHost</c>, <c>StarvationProbeHost</c> and
        /// <c>RegistrationRecordingHost</c> all implement <see cref="IUplinkHost"/>),
        /// and a double's own <c>AddGateEvaluator(ICommandGateEvaluator)</c> is a
        /// signature it is obliged to have, not an assertion about anything. Without
        /// this, three seams were reported covered by fakes on the first run.</para>
        ///
        /// <para>Nothing here is a list: the answer comes from what compiles, so an
        /// assertion deleted or renamed stops covering its seam immediately.</para>
        /// </summary>
        private static IReadOnlyList<Type> AssertedParameterTypes()
        {
            var contract = typeof(ISitrepProvider).Assembly;

            return typeof(SeamConformance).Assembly
                .GetTypes()
                .Where(t => t.IsPublic)
                .Where(t => !t.GetInterfaces().Any(i => i.Assembly == contract))
                .SelectMany(t => t.GetMethods(
                    BindingFlags.Public | BindingFlags.Static | BindingFlags.DeclaredOnly))
                .SelectMany(m => m.GetParameters())
                .Select(p => p.ParameterType)
                .Where(t => t.IsInterface && t.Assembly == contract)
                .Distinct()
                .ToList();
        }

        // ── Self-checks ──────────────────────────────────────────────────────────

        [Fact]
        public void ScanFindsItsSubjects()
        {
            var seams = PublicSeams();
            var graph = Scan();

            foreach (var required in new[]
                     {
                         "ISitrepUplink", "IPropagationProvider", "ICommsBackend",
                         "IIntegratedTrajectorySource", "ISitrepProvider",
                     })
            {
                Assert.Contains(seams, t => t.Name == required);
            }

            Assert.True(
                seams.Count >= 30,
                "only " + seams.Count + " public contract seams found, which is far below the "
                + "real count: the reflection walk is truncated");

            Assert.True(
                AssertedParameterTypes().Count >= 1,
                "no conformance assertion found in Sitrep.Contract.TestSupport at all. Every "
                + "seam would then be reported uncovered, or, with a full debt list, none would "
                + "be reported at all");

            Assert.True(
                graph.FilesScanned >= 350,
                "only " + graph.FilesScanned + " production .cs files read, against this repo's "
                + "several hundred: the source walk is truncated");

            Assert.True(
                graph.ProductionTypeCount >= 100,
                "only " + graph.ProductionTypeCount + " production types with a base list found: "
                + "the walk is reading files but not their declarations");
        }

        /// <summary>
        /// Each half is handed an input it must reject, and an input it must accept.
        ///
        /// <para>Both are needed. A check that fails at everything reports the
        /// planted violation and proves nothing about the real tree, and with
        /// <see cref="ConformanceDebt"/> seeded and the documentation half currently
        /// clean, neither ratchet above can demonstrate that it is capable of
        /// reporting anything at all.</para>
        /// </summary>
        [Fact]
        public void TheChecksSeeAPlantedViolation()
        {
            // Documentation: a seam whose type entry is present but whose member is not.
            var documented = new HashSet<string>(StringComparer.Ordinal)
            {
                "T:" + typeof(ISitrepProvider).FullName,
            };
            var missing = UndocumentedSeams(new[] { typeof(ISitrepProvider) }, documented);
            Assert.Contains("ISitrepProvider.ProviderId", missing);

            // ... and the same seam with both entries present is NOT reported.
            documented.Add("P:" + typeof(ISitrepProvider).FullName + ".ProviderId");
            Assert.Empty(UndocumentedSeams(new[] { typeof(ISitrepProvider) }, documented));

            // Conformance: an assertion over an unrelated seam does not cover this one.
            Assert.Contains(
                typeof(ISitrepProvider),
                SeamsWithoutAConformanceAssertion(
                    new[] { typeof(ISitrepProvider) }, new[] { typeof(ISitrepUplink) }));

            // ... and one over a BASE of the seam does, which is the rule that lets a
            // single assertion cover twenty capability seams.
            Assert.Empty(
                SeamsWithoutAConformanceAssertion(
                    new[] { typeof(IPropagationProvider) }, new[] { typeof(ISitrepProvider) }));

            // The implementer scan, on a source tree written for the purpose: an
            // interface with no implementer is reported, one with a production
            // implementer is not, and one implemented ONLY by a test project's double
            // is reported anyway. That last is the distinction this half rests on.
            var root = Path.Combine(
                Path.GetTempPath(), "seam-scan-" + Guid.NewGuid().ToString("N"));
            try
            {
                Write(root, "Planted.Contract", "Seams.cs", @"
namespace Planted
{
    public interface IPlantedSatisfied { }

    public interface IPlantedUnsatisfied { }

    public interface IPlantedDoubleOnly { }

    public interface IPlantedFirstOfTwo { }

    public interface IPlantedSecondOfTwo { }
}
");
                Write(root, "Planted.Backend", "Backend.cs", @"
namespace Planted
{
    public sealed class PlantedBackend : IPlantedSatisfied { }

    public sealed class PlantedTwoSeamBackend : IPlantedFirstOfTwo,
        IPlantedSecondOfTwo { }
}
");
                Write(root, "Planted.Backend.Tests", "Doubles.cs", @"
namespace Planted.Tests
{
    public sealed class FakeBackend : IPlantedDoubleOnly { }
}
");

                var graph = Scan(root);

                Assert.Equal(5, graph.ProductionInterfaces.Count);
                Assert.Contains("IPlantedSatisfied", graph.Satisfied);
                Assert.DoesNotContain("IPlantedUnsatisfied", graph.Satisfied);
                Assert.DoesNotContain("IPlantedDoubleOnly", graph.Satisfied);

                // Declared in one project and satisfied from another, by a base list
                // naming two interfaces across a line break.
                Assert.Contains("IPlantedFirstOfTwo", graph.Satisfied);
                Assert.Contains("IPlantedSecondOfTwo", graph.Satisfied);
                Assert.Equal(2, graph.ProductionTypeCount);
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

        // ── The source walk, for the private half ────────────────────────────────

        /// <summary>
        /// Projects whose types do not count as production: a test double satisfying
        /// an interface is exactly the situation the private half exists to
        /// distinguish from a real implementation.
        /// </summary>
        private static bool IsTestProject(string projectName) =>
            projectName.EndsWith(".Tests", StringComparison.Ordinal)
            || projectName.EndsWith(".TestSupport", StringComparison.Ordinal)
            || projectName.Contains("IntegrationTests", StringComparison.Ordinal)
            || projectName.Equals("GonogoDevTools", StringComparison.Ordinal);

        private sealed class TypeGraph
        {
            /// <summary>Interface name -> where it is declared, production only.</summary>
            public Dictionary<string, string> ProductionInterfaces { get; } =
                new(StringComparer.Ordinal);

            /// <summary>Interfaces a production type implements, closed over inheritance.</summary>
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

        private static TypeGraph Scan() => Scan(ResolveModDir());

        private static TypeGraph Scan(string modDir)
        {
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
