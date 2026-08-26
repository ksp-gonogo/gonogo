using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using Xunit;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// The census of EXCLUSIVE capabilities, and the map from each one to the
    /// behavioural case that proves it is not starved.
    ///
    /// <para><b>What starvation is.</b>
    /// <c>IUplinkHost.AddSampledSource</c>'s subscription-gated overload skips its
    /// main-thread capture entirely on any tick where nothing under its declared
    /// topic prefixes is subscribed. That is a pure early-out only for a capture
    /// whose whole effect is its return value. When a capture also WRITES state
    /// that something else reads, and that something else is an exclusive
    /// capability's elected provider, the derived channel is starved: no exception,
    /// no log line, and because the capability is exclusive there is no vanilla
    /// answering underneath either. Three shipped that way. The control frame was
    /// found on a rig, the maneuver plan published a payload whose absent planner
    /// field is documented to mean "there is no planner", and RP-1 told an operator
    /// that a career it manages was a save it does not.</para>
    ///
    /// <para><b>What this file is and is not.</b> It is the CENSUS: it enumerates
    /// every exclusive capability declared anywhere in production and refuses an
    /// entry it has never been told about. It is not the behavioural proof. That
    /// lives in each Uplink's own Tests project, where the Uplink's sources already
    /// compile and where a red names the Uplink that broke, and this file names the
    /// case per capability so a capability whose proof is deleted or renamed fails
    /// here rather than passing quietly.</para>
    ///
    /// <para><b>Why enumeration cannot be a hand-written list alone.</b> A list
    /// nobody re-derives stops describing the tree. So the set is read out of the
    /// production declaration sites on every run and compared against the map in
    /// both directions: an exclusive capability nobody put in the map fails, and a
    /// map entry whose declaration site has gone fails too.</para>
    /// </summary>
    public class ExclusiveCapabilityCensusTests
    {
        /// <summary>
        /// One exclusive capability, with what is known about how it can starve.
        /// </summary>
        /// <param name="Id">The capability id, as the declaration site resolves it.</param>
        /// <param name="DeclaredIn">Repo-relative path of the file declaring it.</param>
        /// <param name="UplinkProviders">
        /// The Uplinks that register a provider for it today. Empty means no Uplink
        /// can win it, so there is nothing an Uplink's capture could starve.
        /// </param>
        /// <param name="FedByGatedCapture">
        /// Whether the elected provider's answer comes from a subscription-gated
        /// capture. This is the unsafe shape, and the reason the case for it
        /// subscribes ONLY the derived topic rather than driving a bare tick.
        /// </param>
        /// <param name="ProvenBy">
        /// The [Fact] that drives ticks and asserts the capability answers, as
        /// "&lt;Tests project&gt;/&lt;file&gt;.cs::&lt;method&gt;". Empty only where
        /// <paramref name="UplinkProviders"/> is empty, or where
        /// <paramref name="WhyNotProven"/> says why not.
        /// </param>
        /// <param name="WhyNotProven">
        /// Why a capability an Uplink can win has no behavioural case. Never a
        /// placeholder: an entry here is a gap somebody can close, stated so the
        /// gap is visible rather than absent.
        /// </param>
        private sealed record Entry(
            string Id,
            string DeclaredIn,
            string[] UplinkProviders,
            bool FedByGatedCapture,
            string ProvenBy,
            string WhyNotProven = "");

        /// <summary>
        /// Every exclusive capability in the tree, as of 2026-08-26.
        ///
        /// <para>Eleven are declared. Ten have a first-party Uplink provider;
        /// <c>delayedScience</c> is declared with a vanilla and nothing registers
        /// against it, so no Uplink capture is on its path.</para>
        /// </summary>
        private static readonly Entry[] Census =
        {
            new Entry(
                "controlFrame",
                "Sitrep.Host/ControlFrameElection.cs",
                new[] { "GonogoPrincipiaUplink" },
                FedByGatedCapture: true,
                "GonogoPrincipiaUplink.Tests/ExclusiveCapabilityStarvationTests.cs"
                    + "::TheControlFrameAnswersWithOnlyItsDerivedTopicSubscribed"),
            new Entry(
                "maneuverPlan",
                "Sitrep.Host/Maneuver/ManeuverPlanElection.cs",
                new[] { "GonogoPrincipiaUplink" },
                FedByGatedCapture: true,
                "GonogoPrincipiaUplink.Tests/ExclusiveCapabilityStarvationTests.cs"
                    + "::TheManeuverPlanAnswersWithOnlyItsDerivedTopicSubscribed"),
            new Entry(
                "propagation",
                "Sitrep.Host/Propagation/PropagationElection.cs",
                new[] { "GonogoPrincipiaUplink" },
                FedByGatedCapture: false,
                "GonogoPrincipiaUplink.Tests/ExclusiveCapabilityStarvationTests.cs"
                    + "::PropagationAnswersWithoutATickHavingBeenDrivenAtAll"),
            new Entry(
                "gravityModel",
                "Sitrep.Host/Propagation/GravityModelElection.cs",
                new[] { "GonogoPrincipiaUplink" },
                FedByGatedCapture: false,
                "GonogoPrincipiaUplink.Tests/ExclusiveCapabilityStarvationTests.cs"
                    + "::TheGravityModelAnswersWithoutATickHavingBeenDrivenAtAll"),
            new Entry(
                "economy",
                "Sitrep.Host/Economy/EconomyElection.cs",
                new[] { "GonogoRp1Uplink" },
                FedByGatedCapture: false,
                "GonogoRp1Uplink.Tests/EconomyStarvationTests.cs"
                    + "::The_economy_backend_answers_with_nothing_subscribed"),
            new Entry(
                "actionGroups",
                "Sitrep.Host/ActionGroups/ActionGroupsElection.cs",
                new[] { "GonogoActionGroupsExtendedUplink" },
                FedByGatedCapture: false,
                "GonogoActionGroupsExtendedUplink.Tests/ActionGroupsStarvationTests.cs"
                    + "::The_action_groups_backend_answers_with_nothing_subscribed"),
            new Entry(
                "delayedScience",
                "Gonogo.KSP/CurrencyEventUplink.cs",
                Array.Empty<string>(),
                FedByGatedCapture: false,
                ProvenBy: "",
                WhyNotProven: "No Uplink registers a provider: the capability is "
                    + "declared with a vanilla and core's own sink is the only "
                    + "instance, so no Uplink capture is on its path. An Uplink "
                    + "provider appearing here is a change to this line."),
            new Entry(
                "science",
                "Sitrep.Host/Science/ScienceElection.cs",
                new[] { "GonogoKerbalismUplink" },
                FedByGatedCapture: true,
                ProvenBy: "",
                WhyNotProven: "KerbalismUplink.Register reads FlightGlobals, so the "
                    + "registration path does not compile into a headless Tests "
                    + "project and no case can drive it. The starvation is REAL and "
                    + "documented at KerbalismScienceBackend.Latest: with no "
                    + "science. subscription the elected backend reports unmodelled "
                    + "and the five File Manager verbs refuse. It stands because "
                    + "ScienceFileManager subscribes science.experiments in the same "
                    + "component that sends the verbs, which is one client's "
                    + "construction rather than a guarantee."),
            new Entry(
                "isru",
                "Sitrep.Host/Isru/IsruElection.cs",
                new[] { "GonogoKerbalismUplink" },
                FedByGatedCapture: false,
                ProvenBy: "",
                WhyNotProven: "Same headless limit as science above. The provider "
                    + "constructs fresh and reads live Kerbalism, and IsruCoreUplink "
                    + "calls it from ITS OWN capture gated on the isru topics, so "
                    + "the gate and the demand are the same subscription."),
            new Entry(
                "reliability",
                "Sitrep.Host/Reliability/ReliabilityElection.cs",
                new[] { "GonogoKerbalismUplink", "GonogoTestFlightUplink" },
                FedByGatedCapture: false,
                ProvenBy: "",
                WhyNotProven: "Same headless limit as science above, for both "
                    + "providers. Each constructs fresh and reads live, and "
                    + "ReliabilityCoreUplink calls the winner from ITS OWN capture "
                    + "gated on the reliability topics."),
            new Entry(
                "comms",
                "Sitrep.Host/Comms/CommsElection.cs",
                new[] { "GonogoRealAntennasUplink" },
                FedByGatedCapture: false,
                ProvenBy: "",
                WhyNotProven: "RealAntennasUplink.Register reads stock CommNet, so "
                    + "the same headless limit applies. The provider is constructed "
                    + "fresh per election and reads live RA, and the delay and "
                    + "connectivity sources CommsCoreUplink installs beside it are "
                    + "deliberately UNGATED."),
        };

        /// <summary>
        /// A capability declared <c>Exclusive = true</c> somewhere in production,
        /// with the id resolved through whatever constant the declaration names.
        /// </summary>
        private sealed record Declaration(string Id, string File, int Line);

        [Fact]
        public void EveryExclusiveCapabilityDeclaredInProductionIsInTheCensus()
        {
            var declared = ExclusiveDeclarations();
            var censused = Census.Select(e => e.Id).ToHashSet(StringComparer.Ordinal);

            var missing = declared
                .Where(d => !censused.Contains(d.Id))
                .Select(d => $"{d.Id} ({d.File}:{d.Line})")
                .OrderBy(s => s, StringComparer.Ordinal)
                .ToList();

            Assert.True(
                missing.Count == 0,
                "An EXCLUSIVE capability is declared that this census has never been "
                + "told about, so nothing anywhere asks whether it can be starved by a "
                + "gated capture. Add it to Census with the case that proves it "
                + "answers, or with why there is none:\n  "
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
                "A census entry names a capability nothing declares Exclusive any "
                + "more. A census carrying entries nobody re-derives stops describing "
                + "the tree, so remove it or fix the id:\n  "
                + string.Join("\n  ", stale));

            var moved = Census
                .Where(e => declared.ContainsKey(e.Id)
                    && !declared[e.Id].File.EndsWith(e.DeclaredIn, StringComparison.Ordinal))
                .Select(e => $"{e.Id}: census says {e.DeclaredIn}, found at {declared[e.Id].File}")
                .ToList();

            Assert.True(
                moved.Count == 0,
                "A capability is declared somewhere other than where the census says. "
                + "Point the entry at the new file:\n  " + string.Join("\n  ", moved));
        }

        /// <summary>
        /// The behavioural proof this census points at has to exist. A named case
        /// that was renamed or deleted leaves the census asserting a coverage that
        /// is no longer there, which reads as covered and is not.
        /// </summary>
        [Fact]
        public void EveryCapabilityAnUplinkCanWinIsEitherProvenOrSaysWhyNot()
        {
            var mod = ResolveModDir();
            var problems = new List<string>();

            foreach (var entry in Census.Where(e => e.UplinkProviders.Length > 0))
            {
                if (entry.ProvenBy.Length == 0)
                {
                    if (entry.WhyNotProven.Length == 0)
                    {
                        problems.Add(
                            $"{entry.Id}: an Uplink can win it, and the census neither "
                            + "names a case nor says why there is none");
                    }
                    continue;
                }

                var parts = entry.ProvenBy.Split("::", StringSplitOptions.None);
                Assert.True(parts.Length == 2, $"{entry.Id}: ProvenBy must read <file>::<method>");

                var path = Path.Combine(mod, parts[0].Replace('/', Path.DirectorySeparatorChar));
                if (!File.Exists(path))
                {
                    problems.Add($"{entry.Id}: no such file {parts[0]}");
                    continue;
                }

                var source = File.ReadAllText(path);
                if (!Regex.IsMatch(source, @"\bvoid\s+" + Regex.Escape(parts[1]) + @"\s*\("))
                {
                    problems.Add($"{entry.Id}: {parts[0]} has no test named {parts[1]}");
                }
            }

            Assert.True(
                problems.Count == 0,
                "The census points at behavioural proof that is not there:\n  "
                + string.Join("\n  ", problems));
        }

        /// <summary>
        /// The scan asserts it found its subjects.
        ///
        /// <para>A source-walking gate whose walk returns nothing reports no
        /// violations, and no violations reads exactly like success. This repo has
        /// been bitten by that shape more than once, so the discovery is pinned
        /// separately: the files it must have read, the ids it must have found, and
        /// a floor under the count. If the layout moves, this fails FIRST and says
        /// so, rather than the census above passing over an empty set.</para>
        /// </summary>
        [Fact]
        public void TheScanFoundItsSubjects()
        {
            var declared = ExclusiveDeclarations();

            Assert.True(
                declared.Count >= 11,
                "The scan found " + declared.Count + " exclusive capability "
                + "declarations. Eleven were there on 2026-08-26 and capabilities are "
                + "not removed lightly, so a smaller number means the walk is no "
                + "longer reaching the declaration sites.");

            var ids = declared.Select(d => d.Id).ToHashSet(StringComparer.Ordinal);
            foreach (var known in new[] { "controlFrame", "maneuverPlan", "comms", "delayedScience" })
            {
                Assert.True(
                    ids.Contains(known),
                    "The scan did not find the '" + known + "' capability, which is "
                    + "declared in production. The walk or the id resolver is broken.");
            }
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

                    // The id is the sibling initializer. Searched backwards from the
                    // Exclusive line to the start of the object initializer rather
                    // than assumed adjacent, so reordering the initializer does not
                    // silently drop a capability out of the census.
                    var id = ResolveIdAbove(lines, i, file, constants);
                    found.Add(new Declaration(id, file, i + 1));
                }
            }

            return found;
        }

        /// <summary>
        /// The <c>Id = ...</c> nearest above <paramref name="exclusiveLine"/>,
        /// resolved to the string it names.
        ///
        /// <para>Throws rather than returning a placeholder when it cannot resolve.
        /// A census that quietly recorded "unknown" would compare "unknown" against
        /// itself and pass, which is the failure mode this whole file exists to
        /// stop.</para>
        /// </summary>
        private static string ResolveIdAbove(
            string[] lines, int exclusiveLine, string file, Dictionary<string, string> constants)
        {
            for (var i = exclusiveLine; i >= 0 && i > exclusiveLine - 12; i--)
            {
                var match = Regex.Match(lines[i], @"^\s*Id\s*=\s*([^,]+),\s*$");
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
                    + "The census cannot record what it cannot name; teach Resolve "
                    + "the new shape.");
            }

            throw new InvalidOperationException(
                $"{file}:{exclusiveLine + 1} has Exclusive = true with no Id above it. "
                + "The census cannot record what it cannot name.");
        }

        /// <summary>
        /// A literal, a bare constant in the same file, or a <c>Type.Member</c>
        /// naming a constant elsewhere. Chased through one indirection, which is
        /// what <c>CapabilityId = ControlFrameCapability.Id</c> needs.
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
        /// Every <c>const string</c> in production, keyed
        /// <c>&lt;declaring type&gt;.&lt;name&gt;</c> and valued as the right-hand
        /// side verbatim, so <see cref="Resolve"/> can walk an alias chain.
        ///
        /// <para>Keyed twice, by enclosing type and by file name, because a bare
        /// <c>CapabilityId</c> in a declaration names the type its file is named
        /// for while a qualified <c>ControlFrameCapability.Id</c> names a type
        /// sharing a file with others. A type's constants are read only between its
        /// own declaration and the next one, so a constant is never attributed to a
        /// neighbour: an id that cannot be resolved fails loudly rather than
        /// resolving to the wrong string.</para>
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
                        constants[name + "." + match.Groups[1].Value] =
                            match.Groups[2].Value.Trim();
                    }
                }

                // Keyed by file name too, which is how a bare CapabilityId in a
                // declaration resolves without parsing the enclosing type.
                var fileType = Path.GetFileNameWithoutExtension(file);
                foreach (Match match in constant.Matches(text))
                {
                    constants[fileType + "." + match.Groups[1].Value] =
                        match.Groups[2].Value.Trim();
                }
            }

            return constants;
        }

        /// <summary>Every production <c>.cs</c> under <c>mod/</c>: no tests, no build output.</summary>
        private static IEnumerable<string> ProductionSources(string mod) =>
            Directory.EnumerateFiles(mod, "*.cs", SearchOption.AllDirectories)
                .Where(f =>
                {
                    var relative = f.Substring(mod.Length).Replace('\\', '/');
                    return !relative.Contains("/obj/", StringComparison.Ordinal)
                        && !relative.Contains("/bin/", StringComparison.Ordinal)
                        && !relative.Contains(".Tests/", StringComparison.Ordinal);
                });

        /// <summary>
        /// Walks up from the test assembly to the checked-out <c>mod/</c> directory,
        /// same pattern as <c>UplinkIsolationTests.ResolveModDir</c>.
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
