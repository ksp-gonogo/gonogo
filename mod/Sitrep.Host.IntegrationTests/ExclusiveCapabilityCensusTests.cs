using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using Xunit;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// The census of EXCLUSIVE capabilities, and the guard that every one an Uplink
    /// can win has a behavioural case proving it is not starved.
    ///
    /// <para><b>What starvation is.</b>
    /// <c>IUplinkHost.AddSampledSource</c>'s subscription-gated overload skips its
    /// main-thread capture entirely on any tick where nothing under its declared
    /// topic prefixes is subscribed. That is a pure early-out only for a capture
    /// whose whole effect is its return value. When a capture also WRITES state
    /// something else reads, and that something else is an exclusive capability's
    /// elected provider, the derived channel is starved: no exception, no log line,
    /// and because the capability is exclusive there is no vanilla answering
    /// underneath either. Three shipped that way. One was found on a rig after
    /// 45 seconds of silence, one published a payload whose absent planner field is
    /// documented to mean "there is no planner", and one told an operator that a
    /// career it was managing was a save it does not manage.</para>
    ///
    /// <para><b>Everything here is DISCOVERED, and deliberately names no mod.</b>
    /// Which capabilities are exclusive, which have an Uplink provider, and which
    /// have a behavioural case are all read out of the tree on every run. A written
    /// list would drift, and naming the Uplinks would put specific third-party mods
    /// in a core test project, which <c>uplink-boundary.test.ts</c> forbids for the
    /// good reason that core has no business knowing them. The behavioural cases
    /// live in each Uplink's own Tests project, where the Uplink's sources already
    /// compile and where a red names the Uplink that broke; each one carries the
    /// marker this file counts.</para>
    ///
    /// <para><b>The limit, stated rather than left to be found.</b> A marker is a
    /// claim. This file checks that the claim is made in a file that holds tests,
    /// not that the test behind it asserts anything. What it does catch is the
    /// failure that actually happens: a capability arriving with no case at all, and
    /// a case being deleted or moved out from under one.</para>
    /// </summary>
    public class ExclusiveCapabilityCensusTests
    {
        /// <summary>
        /// The marker a behavioural case carries, followed by the capability id it
        /// covers. Written as a comment beside the case rather than derived from the
        /// file name, so a case can move or be renamed without the census losing
        /// track of what it proves.
        /// </summary>
        private const string Marker = "exclusive-capability-starvation:";

        /// <summary>
        /// One exclusive capability the census knows about.
        /// </summary>
        /// <param name="Id">The capability id, as its declaration site resolves it.</param>
        /// <param name="DeclaredIn">Repo-relative path of the file declaring it exclusive.</param>
        /// <param name="FedByGatedCapture">
        /// Whether the elected provider's answer comes from a subscription-gated
        /// capture. The unsafe shape, and the reason a case for it subscribes ONLY
        /// the derived topic rather than driving a bare tick.
        /// </param>
        /// <param name="WhyNoBehaviouralCase">
        /// Why a capability an Uplink can win has no case. Never a placeholder: an
        /// entry here is a gap somebody can close, written down so the gap is
        /// visible rather than absent, and asserted STALE once a case appears.
        /// </param>
        private sealed record Entry(
            string Id,
            string DeclaredIn,
            bool FedByGatedCapture,
            string WhyNoBehaviouralCase = "");

        /// <summary>
        /// Every exclusive capability in the tree, as of 2026-08-26. Twelve are
        /// declared; eleven have a provider registered from an Uplink, which this
        /// file discovers rather than restates.
        /// </summary>
        private static readonly Entry[] Census =
        {
            new Entry("controlFrame", "Sitrep.Host/ControlFrameElection.cs", FedByGatedCapture: true),
            new Entry("maneuverPlan", "Sitrep.Host/Maneuver/ManeuverPlanElection.cs", FedByGatedCapture: true),
            new Entry("propagation", "Sitrep.Host/Propagation/PropagationElection.cs", FedByGatedCapture: false),
            new Entry("gravityModel", "Sitrep.Host/Propagation/GravityModelElection.cs", FedByGatedCapture: false),
            new Entry("economy", "Sitrep.Host/Economy/EconomyElection.cs", FedByGatedCapture: false),
            new Entry("actionGroups", "Sitrep.Host/ActionGroups/ActionGroupsElection.cs", FedByGatedCapture: false),
            new Entry("crewStanding", "Sitrep.Host/Crew/CrewStandingElection.cs", FedByGatedCapture: false),
            new Entry(
                "simulation",
                "Sitrep.Host/Comms/SimulationElection.cs",
                FedByGatedCapture: false,
                WhyNoBehaviouralCase: "The provider is registered at Register time from a live "
                    + "reflection probe, not fed by any capture, so there is no gated path that "
                    + "could starve it. The flight.simulation CHANNEL is subscription-gated and "
                    + "safe to be: its source's whole effect is its return value, and the delay "
                    + "cut it reports rides a config read every tick regardless of who watches. "
                    + "No behavioural case, for the same reason as economy before it: the "
                    + "Register that wires it reads live KSP and that Uplink's Tests project "
                    + "compiles a curated file list that cannot include it."),
            new Entry(
                "delayedScience",
                "Gonogo.KSP/CurrencyEventUplink.cs",
                FedByGatedCapture: false,
                WhyNoBehaviouralCase: "No Uplink registers a provider, so no Uplink "
                    + "capture is on its path. Discovered, not assumed: an Uplink "
                    + "provider appearing for it makes this line stale and fails."),
            new Entry(
                "science",
                "Sitrep.Host/Science/ScienceElection.cs",
                FedByGatedCapture: false,
                WhyNoBehaviouralCase: "The starvation here was real and is FIXED. "
                    + "One provider's capture stashes the bundle its five command "
                    + "verbs read as a pre-filter, so the handler's effect escapes "
                    + "the publish path and the capture is now registered ungated; "
                    + "its own Uplink's Tests project guards that. The other "
                    + "provider's capture stays gated and is correct, because its "
                    + "handler only publishes. No behavioural case from here: each "
                    + "Register reads live KSP, and those Tests projects compile a "
                    + "curated file list that cannot include it. The KSP-linked leg "
                    + "is separate work."),
            new Entry(
                "isru",
                "Sitrep.Host/Isru/IsruElection.cs",
                FedByGatedCapture: false,
                WhyNoBehaviouralCase: "Same limit as science: the Register that wires "
                    + "the provider reads live KSP. The provider constructs fresh and "
                    + "reads live, and core calls it from ITS OWN capture gated on the "
                    + "topics that display it, so the gate and the demand are one "
                    + "subscription."),
            new Entry(
                "reliability",
                "Sitrep.Host/Reliability/ReliabilityElection.cs",
                FedByGatedCapture: false,
                WhyNoBehaviouralCase: "Same limit as isru, for both of its providers."),
            new Entry(
                "comms",
                "Sitrep.Host/Comms/CommsElection.cs",
                FedByGatedCapture: false,
                WhyNoBehaviouralCase: "Same limit again: the Register that wires the "
                    + "provider reads stock CommNet. The provider is constructed fresh "
                    + "per election and reads live, and the delay and connectivity "
                    + "sources installed beside it are deliberately UNGATED."),
        };

        /// <summary>
        /// A capability declared <c>Exclusive = true</c> somewhere in production,
        /// with the id resolved through whatever constant the declaration names.
        /// </summary>
        private sealed record Declaration(string Id, string File, int Line);

        [Fact]
        public void EveryExclusiveCapabilityDeclaredInProductionIsInTheCensus()
        {
            var censused = Census.Select(e => e.Id).ToHashSet(StringComparer.Ordinal);

            var missing = ExclusiveDeclarations()
                .Where(d => !censused.Contains(d.Id))
                .Select(d => $"{d.Id} ({Relative(d.File)}:{d.Line})")
                .OrderBy(s => s, StringComparer.Ordinal)
                .ToList();

            Assert.True(
                missing.Count == 0,
                "An EXCLUSIVE capability is declared that this census has never been "
                + "told about, so nothing anywhere asks whether it can be starved by a "
                + "gated capture. Add it to Census, and give it a behavioural case in "
                + "its Uplink's Tests project carrying the '" + Marker + " <id>' marker, "
                + "or say why there is none:\n  "
                + string.Join("\n  ", missing));
        }

        [Fact]
        public void EveryCensusEntryStillNamesADeclarationThatExists()
        {
            var declared = ExclusiveDeclarations().ToDictionary(d => d.Id, StringComparer.Ordinal);

            var stale = Census
                .Where(e => !declared.ContainsKey(e.Id))
                .Select(e => $"{e.Id} (census says {e.DeclaredIn})")
                .ToList();

            Assert.True(
                stale.Count == 0,
                "A census entry names a capability nothing declares Exclusive any more. "
                + "A census carrying entries nobody re-derives stops describing the "
                + "tree, so remove it or fix the id:\n  " + string.Join("\n  ", stale));

            var moved = Census
                .Where(e => declared.ContainsKey(e.Id)
                    && !Relative(declared[e.Id].File).Equals(e.DeclaredIn, StringComparison.Ordinal))
                .Select(e => $"{e.Id}: census says {e.DeclaredIn}, found at {Relative(declared[e.Id].File)}")
                .ToList();

            Assert.True(
                moved.Count == 0,
                "A capability is declared somewhere other than where the census says. "
                + "Point the entry at the new file:\n  " + string.Join("\n  ", moved));
        }

        /// <summary>
        /// The guard itself: a capability an Uplink can win must have a behavioural
        /// case, or the census must say why not.
        /// </summary>
        [Fact]
        public void EveryCapabilityAnUplinkCanWinIsEitherProvenOrSaysWhyNot()
        {
            var winnable = UplinkProvidedCapabilities();
            var covered = MarkedCapabilities();
            var problems = new List<string>();

            foreach (var entry in Census.Where(e => winnable.Contains(e.Id)))
            {
                if (covered.Contains(entry.Id) || entry.WhyNoBehaviouralCase.Length > 0)
                {
                    continue;
                }

                problems.Add(
                    $"{entry.Id}: an Uplink registers a provider for it and no "
                    + "behavioural case claims it. Drive ticks with only its derived "
                    + "topic subscribed, assert the election answers, and mark the case "
                    + $"'{Marker} {entry.Id}'");
            }

            Assert.True(
                problems.Count == 0,
                "An exclusive capability an Uplink can win is unproven:\n  "
                + string.Join("\n  ", problems));
        }

        /// <summary>
        /// The other direction, so an excuse cannot outlive the thing it excused. A
        /// reason kept beside a case that now exists is a reason nobody reads.
        /// </summary>
        [Fact]
        public void NoCensusEntryExcusesACapabilityThatIsActuallyProven()
        {
            var covered = MarkedCapabilities();
            var winnable = UplinkProvidedCapabilities();

            var staleExcuses = Census
                .Where(e => e.WhyNoBehaviouralCase.Length > 0 && covered.Contains(e.Id))
                .Select(e => e.Id)
                .ToList();

            Assert.True(
                staleExcuses.Count == 0,
                "A census entry says a capability has no behavioural case, and one now "
                + "carries its marker. Delete the excuse:\n  "
                + string.Join("\n  ", staleExcuses));

            var wronglyExcused = Census
                .Where(e => e.WhyNoBehaviouralCase.Length > 0
                    && !winnable.Contains(e.Id)
                    && !e.WhyNoBehaviouralCase.Contains("No Uplink registers a provider", StringComparison.Ordinal))
                .Select(e => e.Id)
                .ToList();

            Assert.True(
                wronglyExcused.Count == 0,
                "A census entry excuses a capability no Uplink provides for a reason "
                + "about an Uplink. Either an Uplink stopped providing it, in which "
                + "case say so, or the id is wrong:\n  "
                + string.Join("\n  ", wronglyExcused));
        }

        /// <summary>
        /// The scan asserts it found its subjects.
        ///
        /// <para>A source-walking gate whose walk returns nothing reports no
        /// violations, and no violations reads exactly like success. This repo has
        /// been bitten by that shape more than once, so all three discoveries are
        /// pinned separately: the exclusive set, the Uplink-provided set, and the
        /// marker set. If the layout moves, this fails FIRST and says so, rather than
        /// the guard above passing over an empty set.</para>
        /// </summary>
        [Fact]
        public void TheScansFoundTheirSubjects()
        {
            var declared = ExclusiveDeclarations();
            Assert.True(
                declared.Count >= 11,
                "The scan found " + declared.Count + " exclusive capability "
                + "declarations. Eleven were there on 2026-08-26 and capabilities are "
                + "not removed lightly, so fewer means the walk is no longer reaching "
                + "the declaration sites.");

            var ids = declared.Select(d => d.Id).ToHashSet(StringComparer.Ordinal);
            foreach (var known in new[] { "controlFrame", "maneuverPlan", "comms", "delayedScience" })
            {
                Assert.True(
                    ids.Contains(known),
                    "The scan did not find the '" + known + "' capability, which is "
                    + "declared in production. The walk or the id resolver is broken.");
            }

            var winnable = UplinkProvidedCapabilities();
            Assert.True(
                winnable.Count >= 10,
                "The provider scan found " + winnable.Count + " exclusive capabilities "
                + "with an Uplink provider, and ten had one on 2026-08-26. Fewer means "
                + "the scan is no longer reading the registration sites, which would "
                + "make every capability look unwinnable and the guard vacuous.");

            var covered = MarkedCapabilities();
            Assert.True(
                covered.Count >= 6,
                "The marker scan found " + covered.Count + " capabilities claimed by a "
                + "behavioural case, and six carried a marker on 2026-08-26. Fewer "
                + "means the marker scan is not reaching the Tests projects, which "
                + "would make the coverage guard fail loudly rather than silently, but "
                + "for the wrong reason.");
        }

        /// <summary>
        /// Every <c>Exclusive = true</c> in a production file, with the id resolved.
        ///
        /// <para>Tests are excluded because a test declaring a capability is a
        /// fixture, not a hazard: nothing ships behind it.</para>
        /// </summary>
        private static List<Declaration> ExclusiveDeclarations()
        {
            var mod = ResolveModDir();
            var constants = StringConstants(mod);
            var found = new List<Declaration>();

            foreach (var file in ProductionSources(mod))
            {
                var lines = File.ReadAllLines(file);
                for (var i = 0; i < lines.Length; i++)
                {
                    if (!Regex.IsMatch(lines[i], @"^\s*Exclusive\s*=\s*true\s*,?\s*$"))
                    {
                        continue;
                    }

                    found.Add(new Declaration(
                        ResolveIdAbove(lines, i, file, constants, @"^\s*Id\s*=\s*([^,]+),\s*$"),
                        file,
                        i + 1));
                }
            }

            return found;
        }

        /// <summary>
        /// Every capability an Uplink registers a provider for, read from the
        /// <c>Capability = ...</c> line of each registration inside a
        /// <c>Gonogo*Uplink</c> project.
        ///
        /// <para>Discovered rather than listed for two reasons. A list drifts, and a
        /// list would have to spell the Uplinks' names in a core test project, which
        /// is the coupling <c>uplink-boundary.test.ts</c> exists to stop.</para>
        /// </summary>
        private static HashSet<string> UplinkProvidedCapabilities()
        {
            var mod = ResolveModDir();
            var constants = StringConstants(mod);
            var found = new HashSet<string>(StringComparer.Ordinal);
            var registration = new Regex(@"^\s*Capability\s*=\s*([^,]+),\s*$", RegexOptions.Compiled);

            foreach (var directory in UplinkDirectories(mod))
            {
                foreach (var file in Directory.EnumerateFiles(directory, "*.cs", SearchOption.AllDirectories))
                {
                    if (IsBuildOutput(file))
                    {
                        continue;
                    }

                    foreach (var line in File.ReadAllLines(file))
                    {
                        var match = registration.Match(line);
                        if (!match.Success)
                        {
                            continue;
                        }

                        var id = Resolve(match.Groups[1].Value.Trim(), file, constants);
                        if (id == null)
                        {
                            throw new InvalidOperationException(
                                $"{file} registers a provider for capability expression "
                                + $"'{match.Groups[1].Value.Trim()}' and the census could "
                                + "not resolve it to a string. It cannot record what it "
                                + "cannot name; teach Resolve the new shape.");
                        }

                        found.Add(id);
                    }
                }
            }

            return found;
        }

        /// <summary>
        /// Every capability claimed by a marker in a Tests project, where the marked
        /// file also holds at least one test.
        /// </summary>
        private static HashSet<string> MarkedCapabilities()
        {
            var mod = ResolveModDir();
            var found = new HashSet<string>(StringComparer.Ordinal);
            var marked = new Regex(
                Regex.Escape(Marker) + @"\s*([A-Za-z0-9_]+)", RegexOptions.Compiled);

            foreach (var directory in Directory.EnumerateDirectories(mod)
                .Where(d => Path.GetFileName(d).EndsWith(".Tests", StringComparison.Ordinal)))
            {
                foreach (var file in Directory.EnumerateFiles(directory, "*.cs", SearchOption.AllDirectories))
                {
                    if (IsBuildOutput(file))
                    {
                        continue;
                    }

                    var text = File.ReadAllText(file);
                    if (!text.Contains("[Fact]", StringComparison.Ordinal))
                    {
                        continue;
                    }

                    foreach (Match match in marked.Matches(text))
                    {
                        found.Add(match.Groups[1].Value);
                    }
                }
            }

            return found;
        }

        /// <summary>
        /// The <c>Id = ...</c> nearest above <paramref name="anchorLine"/>, resolved
        /// to the string it names.
        ///
        /// <para>Throws rather than returning a placeholder when it cannot resolve. A
        /// census that quietly recorded "unknown" would compare "unknown" against
        /// itself and pass, which is the failure mode this whole file exists to
        /// stop.</para>
        /// </summary>
        private static string ResolveIdAbove(
            string[] lines,
            int anchorLine,
            string file,
            Dictionary<string, string> constants,
            string pattern)
        {
            for (var i = anchorLine; i >= 0 && i > anchorLine - 12; i--)
            {
                var match = Regex.Match(lines[i], pattern);
                if (!match.Success)
                {
                    continue;
                }

                var expression = match.Groups[1].Value.Trim();
                var resolved = Resolve(expression, file, constants);
                if (resolved != null)
                {
                    return resolved;
                }

                throw new InvalidOperationException(
                    $"{file}:{i + 1} declares an exclusive capability whose id "
                    + $"expression '{expression}' could not be resolved to a string. "
                    + "The census cannot record what it cannot name; teach Resolve the "
                    + "new shape.");
            }

            throw new InvalidOperationException(
                $"{file}:{anchorLine + 1} has Exclusive = true with no Id above it. The "
                + "census cannot record what it cannot name.");
        }

        /// <summary>
        /// A literal, a bare constant in the same file, or a <c>Type.Member</c>
        /// naming a constant elsewhere. Chased through several hops, which is what an
        /// id aliased from a contract constant needs.
        /// </summary>
        private static string? Resolve(
            string expression, string file, Dictionary<string, string> constants)
        {
            for (var hop = 0; hop < 4; hop++)
            {
                var literal = Regex.Match(expression, "^\"([^\"]*)\"$");
                if (literal.Success)
                {
                    return literal.Groups[1].Value;
                }

                var key = expression.Contains('.')
                    ? expression
                    : Path.GetFileNameWithoutExtension(file) + "." + expression;

                if (!constants.TryGetValue(key, out var next))
                {
                    return null;
                }

                expression = next;
            }

            return null;
        }

        /// <summary>
        /// Every <c>const string</c> in production, keyed by enclosing type and by
        /// file name, so <see cref="Resolve"/> can walk an alias chain.
        ///
        /// <para>Keyed twice because a bare <c>CapabilityId</c> in a declaration
        /// names the type its file is named for, while a qualified
        /// <c>SomeCapability.Id</c> names a type sharing a file with others. A type's
        /// constants are read only between its own declaration and the next one, so a
        /// constant is never attributed to a neighbour: an id that cannot be resolved
        /// fails loudly rather than resolving to the wrong string.</para>
        /// </summary>
        private static Dictionary<string, string> StringConstants(string mod)
        {
            var constants = new Dictionary<string, string>(StringComparer.Ordinal);
            var constant = new Regex(
                @"const\s+string\s+([A-Za-z0-9_]+)\s*=\s*([^;]+);", RegexOptions.Compiled);
            var declaration = new Regex(
                @"\b(?:class|struct|record)\s+([A-Za-z0-9_]+)", RegexOptions.Compiled);

            foreach (var file in ProductionSources(mod))
            {
                var text = File.ReadAllText(file);
                var types = declaration.Matches(text);
                for (var t = 0; t < types.Count; t++)
                {
                    var from = types[t].Index;
                    var to = t + 1 < types.Count ? types[t + 1].Index : text.Length;
                    var name = types[t].Groups[1].Value;
                    foreach (Match match in constant.Matches(text.Substring(from, to - from)))
                    {
                        constants[name + "." + match.Groups[1].Value] = match.Groups[2].Value.Trim();
                    }
                }

                var fileType = Path.GetFileNameWithoutExtension(file);
                foreach (Match match in constant.Matches(text))
                {
                    constants[fileType + "." + match.Groups[1].Value] = match.Groups[2].Value.Trim();
                }
            }

            return constants;
        }

        /// <summary>Every <c>Gonogo*Uplink</c> project directory: no Tests, no Contract slice.</summary>
        private static IEnumerable<string> UplinkDirectories(string mod) =>
            Directory.EnumerateDirectories(mod).Where(d =>
            {
                var name = Path.GetFileName(d);
                return name.StartsWith("Gonogo", StringComparison.Ordinal)
                    && name.EndsWith("Uplink", StringComparison.Ordinal)
                    && File.Exists(Path.Combine(d, name + ".csproj"));
            });

        /// <summary>Every production <c>.cs</c> under <c>mod/</c>: no tests, no build output.</summary>
        private static IEnumerable<string> ProductionSources(string mod) =>
            Directory.EnumerateFiles(mod, "*.cs", SearchOption.AllDirectories)
                .Where(f => !IsBuildOutput(f)
                    && !Relative(f).Contains(".Tests/", StringComparison.Ordinal));

        private static bool IsBuildOutput(string file)
        {
            var relative = Relative(file);
            return relative.Contains("/obj/", StringComparison.Ordinal)
                || relative.Contains("/bin/", StringComparison.Ordinal);
        }

        /// <summary>A path under <c>mod/</c>, forward-slashed, for messages and comparisons.</summary>
        private static string Relative(string file)
        {
            var mod = ResolveModDir();
            return file.StartsWith(mod, StringComparison.Ordinal)
                ? file.Substring(mod.Length).TrimStart('/', '\\').Replace('\\', '/')
                : file.Replace('\\', '/');
        }

        /// <summary>
        /// Walks up from the test assembly to the checked-out <c>mod/</c> directory,
        /// same pattern as <c>UplinkIsolationTests.ResolveModDir</c>.
        /// </summary>
        private static string ResolveModDir() => LazyModDir.Value;

        /// <summary>Resolved once: every path this file reports goes through it.</summary>
        private static readonly Lazy<string> LazyModDir = new Lazy<string>(FindModDir);

        private static string FindModDir()
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
